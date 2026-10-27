// Narrow bridge to operator-owned local sponsor services. This is not a proxy
// for arbitrary URLs, SQL, models, filesystem paths, or administration APIs.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {spawn} from 'node:child_process';
import {hex64,validateObservationRequest,validateObservationEnvelope,observationNames,sha256} from './observation-contract.mjs';

export class GatewayAdmissionError extends Error{constructor(status){super('Protected service admission unavailable');this.status=status}}
/** One dispatch per admitted request. Only bounded source operations may wait. */
export function createGatewayLimiter({limit=2,maxPending=16,waitMs=30000}={}){
 let active=0;const pending=[];
 const releaseForSlot=()=>{let released=false;return()=>{if(released)return;released=true;active--;drain()}};
 function drain(){while(active<limit&&pending.length){const item=pending.shift();item.cleanup();if(item.signal?.aborted){item.reject(new DOMException('Request aborted','AbortError'));continue}active++;item.resolve(releaseForSlot())}}
 /** @param {{wait?:boolean,signal?:AbortSignal,maxWaitMs?:number}} [options] */
 function acquire({wait=false,signal,maxWaitMs}={}){
  if(signal?.aborted)return Promise.reject(new DOMException('Request aborted','AbortError'));
  if(active<limit&&!pending.length){active++;return Promise.resolve(releaseForSlot())}
  if(!wait||pending.length>=maxPending)return Promise.reject(new GatewayAdmissionError(429));
  return new Promise((resolve,reject)=>{const item={resolve,reject,signal,cleanup:()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort)}};
   const remove=error=>{const index=pending.indexOf(item);if(index<0)return;pending.splice(index,1);item.cleanup();reject(error);drain()};
   const abort=()=>remove(new DOMException('Request aborted','AbortError'));const timer=setTimeout(()=>remove(new GatewayAdmissionError(503)),Math.min(waitMs,Math.max(1,maxWaitMs??waitMs)));signal?.addEventListener('abort',abort,{once:true});pending.push(item);
   if(signal?.aborted)abort();
  });
 }
 return{acquire,status:()=>({active,pending:pending.length,limit,maxPending})};
}

function dockerCommand(args,input){return new Promise((resolve,reject)=>{
 const child=spawn('docker',args,{env:process.env,stdio:['pipe','pipe','pipe']});const chunks=[];let size=0;const timer=setTimeout(()=>{child.kill();reject(Error('Operator file staging timed out'))},30000);
 child.stdout.on('data',chunk=>{size+=chunk.length;if(size>64000){child.kill();reject(Error('Operator output limit'))}else chunks.push(chunk)});child.stderr.resume();
 child.on('error',()=>{clearTimeout(timer);reject(Error('Operator staging unavailable'))});child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(Buffer.concat(chunks).toString('utf8'));else reject(Error('Operator staging failed'))});child.stdin.on('error',()=>{});child.stdin.end(input);
})}
async function stageObservation(names,recordKey,row){
 const driver=process.env.THESIS_ZETARIS_DRIVER_CONTAINER??'thesis-zetaris-driver-1';if(!/^[A-Za-z0-9_.-]+$/.test(driver))throw Error('Invalid operator container');
 const parent='/home/zetaris/customer-data/shared/thesis-observations',directory=names.directory;
 await dockerCommand(['exec','--user','0',driver,'sh','-c','umask 077; mkdir -p "$1" "$2"; chown 1001:1001 "$1" "$2"; chmod 700 "$1" "$2"','stage',parent,directory]);
 const temporary=directory+'/.'+recordKey+'.'+randomUUID()+'.tmp',target=directory+'/'+recordKey+'.json';
 await dockerCommand(['exec','-i','--user','1001:1001',driver,'sh','-c','umask 077; cat > "$1" && mv "$1" "$2"','stage',temporary,target],JSON.stringify([row]));
 const listing=await dockerCommand(['exec','--user','1001:1001',driver,'find',directory,'-maxdepth','1','-type','f','-name','*.json','-printf','%T@ %f\n']);
 const files=listing.trim().split('\n').flatMap(line=>{const match=line.match(/^([0-9.]+) ([a-f0-9]{64}\.json)$/);return match?[{time:Number(match[1])*1000,name:match[2]}]:[]}).sort((a,b)=>b.time-a.time);
 const expired=files.filter((file,index)=>file.name!==recordKey+'.json'&&(index>=64||file.time<Date.now()-72*3600000));
 if(expired.length)await dockerCommand(['exec','--user','1001:1001',driver,'rm','-f','--',...expired.map(file=>directory+'/'+file.name)]);
}
async function eraseObservationFiles(names){
 const driver=process.env.THESIS_ZETARIS_DRIVER_CONTAINER??'thesis-zetaris-driver-1';if(!/^[A-Za-z0-9_.-]+$/.test(driver))throw Error('Invalid operator container');
 await dockerCommand(['exec','--user','1001:1001',driver,'sh','-c','if [ -d "$1" ]; then find "$1" -maxdepth 1 -type f -delete; fi','erase',names.directory]);
}
const fenceDirectory='/home/zetaris/customer-data/shared/thesis-observation-fences';
const driverContainer=()=>{const value=process.env.THESIS_ZETARIS_DRIVER_CONTAINER??'thesis-zetaris-driver-1';if(!/^[A-Za-z0-9_.-]+$/.test(value))throw Error('Invalid operator container');return value};
const filesystemFences={
 async get(ownerHash){if(!hex64(ownerHash))throw Error('Invalid owner');const output=await dockerCommand(['exec','--user','1001:1001',driverContainer(),'sh','-c','if [ -f "$1" ]; then cat "$1"; else printf 0; fi','fence',fenceDirectory+'/'+ownerHash]);const value=Number(output);if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid owner fence');return value},
 async set(ownerHash,at){if(!hex64(ownerHash)||!Number.isSafeInteger(at)||at<=0)throw Error('Invalid owner fence');await dockerCommand(['exec','--user','0',driverContainer(),'sh','-c','umask 077; mkdir -p "$1"; chown 1001:1001 "$1"; chmod 700 "$1"','fence',fenceDirectory]);const path=fenceDirectory+'/'+ownerHash;await dockerCommand(['exec','-i','--user','1001:1001',driverContainer(),'sh','-c','umask 077; cat > "$1" && mv "$1" "$2"','fence',path+'.'+randomUUID()+'.tmp',path],String(at))}
};
function sqlRows(body){const rows=body?.data;if(!Array.isArray(rows)||!Array.isArray(body.headers))throw Error('Zetaris tabular contract');if(new Set(body.headers).size!==body.headers.length)throw Error('Duplicate SQL headers');return rows.map(row=>{if(!Array.isArray(row)||row.length!==body.headers.length)throw Error('Zetaris row contract');return Object.fromEntries(body.headers.map((key,index)=>[key,row[index]]))})}
/** Factory supports contract tests; production execute is the authenticated actual SQL API. */
export function createObservationBridge({execute,stage=stageObservation,erase=eraseObservationFiles,fences=filesystemFences}){
 const registered=new Set(),locks=new Map();
 async function scoped(owner,work){const prior=locks.get(owner)??Promise.resolve();let release;const gate=new Promise(resolve=>{release=resolve});const tail=prior.catch(()=>{}).then(()=>gate);locks.set(owner,tail);await prior.catch(()=>{});try{return await work()}finally{release();if(locks.get(owner)===tail)locks.delete(owner)}}
 async function roundtrip(body,{signal}={}){if(!validateObservationRequest(body))throw Error('Observation request rejected');return scoped(body.ownerHash,async()=>{
  signal?.throwIfAborted();
  if(body.startedAt<=await fences.get(body.ownerHash))throw Error('Observation predates owner erasure');
  const actual=validateObservationEnvelope(body.envelope),names=observationNames(body.ownerHash);
  const row={owner_hash:body.ownerHash,record_key:body.recordKey,source_kind:body.kind,payload_hash:actual.hash,source_provider:actual.value.provenance.provider,source_as_of:actual.value.provenance.asOf,payload_json:actual.json};
  await stage(names,body.recordKey,row);
  signal?.throwIfAborted();
  if(!registered.has(body.ownerHash)){
   for(const sql of [`CREATE LIGHTNING DATABASE ${names.database} DESCRIBE BY 'Thesis owner-scoped actual financial observations'`,`CREATE LIGHTNING FILESTORE TABLE records FROM ${names.database} FORMAT JSON OPTIONS (path '${names.directory}')`,`CREATE SCHEMASTORE CONTAINER ${names.container}`,`CREATE SCHEMASTORE VIEW observations WITH CONTAINER ${names.container} AS SELECT * FROM ${names.database}.records`]){signal?.throwIfAborted();await execute(sql,2,true,signal)}
   registered.add(body.ownerHash);
  }
  signal?.throwIfAborted();await execute(`REFRESH TABLE ${names.database}.records`,2,false,signal);
  const sql=`SELECT owner_hash, record_key, source_kind, payload_hash, payload_json FROM ${names.view} WHERE owner_hash = '${body.ownerHash}' AND record_key = '${body.recordKey}' AND payload_hash = '${actual.hash}' LIMIT 2`;
  const rows=sqlRows(await execute(sql,2,false,signal));if(rows.length!==1)throw Error('Zetaris owner-scoped observation count mismatch');
  const selected=rows[0];if(selected.owner_hash!==body.ownerHash||selected.record_key!==body.recordKey||selected.source_kind!==body.kind||selected.payload_hash!==actual.hash||typeof selected.payload_json!=='string'||sha256(selected.payload_json)!==actual.hash)throw Error('Zetaris observation identity mismatch');
  const returned=validateObservationEnvelope(JSON.parse(selected.payload_json));if(returned.hash!==actual.hash)throw Error('Zetaris payload mismatch');
  if(body.startedAt<=await fences.get(body.ownerHash)){await erase(names);throw Error('Owner was erased during observation')}
  return{envelope:returned.value,receipt:{provider:'Zetaris',ownerHash:body.ownerHash,recordKey:body.recordKey,payloadHash:actual.hash,view:names.view,queriedAt:new Date().toISOString(),sourceAsOf:returned.value.provenance.asOf,actual:true}};
 })}
 async function eraseOwner(ownerHash){if(!hex64(ownerHash))throw Error('Invalid owner');return scoped(ownerHash,async()=>{const names=observationNames(ownerHash),erasedAt=Math.max(Date.now(),await fences.get(ownerHash));await fences.set(ownerHash,erasedAt);await erase(names);await execute(`REFRESH TABLE ${names.database}.records`,2,false).catch(()=>{});await execute(`UNCACHE TABLE ${names.database}.records`,2,false).catch(()=>{});registered.delete(ownerHash);return{erased:true,ownerHash,erasedAt}})}
 return{roundtrip,eraseOwner};
}

export function authorizeGateway(supplied, key) {
  const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
  const expected = Buffer.from('Bearer ' + key);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export function validateGatewayRequest(path, method, body) {
  if (method === 'GET' && path === '/v1/models') return 'nightshift';
  if (method !== 'POST' || !body || typeof body !== 'object') return null;
  if(path==='/private-observations/roundtrip')return validateObservationRequest(body)?'observations':null;
  if(path==='/private-observations/erase')return Object.keys(body).length===1&&hex64(body.ownerHash)?'observation-erase':null;
  if (path === '/api/v1.0/sql-editor/sqls/run') {
    const market = "'(?:US|India|China|UAE)'";
    const query = new RegExp(`^SELECT \\* FROM thesis\\.research_universe(?: WHERE market IN \\(${market}(?:, ${market}){0,3}\\))? LIMIT 1000$`);
    return query.test(body.sql) && body.limit === 1000 && body.source === 'SqlEditor' && /^[a-f0-9-]{36}$/.test(body.queryId) ? 'zetaris' : null;
  }
  if (path === '/v1/chat/completions') {
    const models = ['local-runtime/qwen2-5-7b-instruct-q4-k-m', 'local-runtime/nemotron-mini-4b-instruct-q4-k-m'];
    const keys = ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'response_format'];
    if (Object.keys(body).some(k => !keys.includes(k)) || !models.includes(body.model) || body.stream !== false || !Number.isInteger(body.max_tokens) || body.max_tokens < 64 || body.max_tokens > 8192 || !(body.temperature === undefined || (body.temperature >= 0 && body.temperature <= 1))) return null;
    if (!Array.isArray(body.messages) || body.messages.length !== 2 || body.messages.some(m => !['system', 'user'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 20000)) return null;
    return 'nightshift';
  }
  return null;
}

export function startGateway() {
  const key = readFileSync(process.env.THESIS_GATEWAY_KEY_FILE, 'utf8').trim();
  if (key.length < 40) throw new Error('A dedicated high entropy gateway key is required.');
  const status = JSON.parse(readFileSync(process.env.THESIS_CONNECTION_STATUS_FILE, 'utf8'));
  const parseEnv = path => Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const at = l.indexOf('='); return [l.slice(0, at), l.slice(at + 1).replace(/^(['"])(.*)\1$/, '$2')]; }));
  const platform = parseEnv(status.platformCredentialsEnvPath);
  let access, validUntil = 0, orgId;
  const limiter=createGatewayLimiter();
  async function login(force = false,signal) {
    if (!force && access && Date.now() < validUntil) return;
    const response = await fetch(status.zetaris.loginUrl, { headers: { Authorization: 'Basic ' + Buffer.from(platform.ZETARIS_ADMIN_EMAIL + ':' + platform.ZETARIS_ADMIN_PASSWORD).toString('base64') }, signal: signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Zetaris authentication unavailable');
    const data = await response.json();
    if (typeof data.idToken !== 'string' || !data.orgId) throw new Error('Zetaris login contract failed');
    access = data.idToken; orgId = String(data.orgId); validUntil = Date.now() + 10 * 60_000;
  }
  async function execute(sql,limit=2,allowExisting=false,signal){
    await login(false,signal);const queryId=randomUUID();
    const result=await fetch(new URL(status.zetaris.baseUrl).origin+'/api/v1.0/sql-editor/sqls/run',{method:'POST',headers:{Authorization:'Bearer '+access,'X-Org-ID':orgId,'X-Request-ID':queryId,'Content-Type':'application/json'},body:JSON.stringify({queryId,sql,source:'SqlEditor',limit}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
    if(result.status===401){access=undefined;validUntil=0}
    const reader=result.body?.getReader();if(!reader)throw Error('SQL body unavailable');let size=0;const chunks=[];
    try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw Error('SQL payload limit')}chunks.push(Buffer.from(value))}}finally{reader.releaseLock()}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('SQL JSON unavailable')}
    const errored=!result.ok||body.error||body.errorMessage||String(body.status??'').toLowerCase()==='error';
    if(errored&&!(allowExisting&&/already exist|already registered|duplicate database|duplicate container/i.test(JSON.stringify(body)))){
     const operation=sql.startsWith('CREATE LIGHTNING DATABASE')?'register_database':sql.startsWith('CREATE LIGHTNING FILESTORE')?'register_source':sql.startsWith('CREATE SCHEMASTORE CONTAINER')?'register_container':sql.startsWith('CREATE SCHEMASTORE VIEW')?'register_view':sql.startsWith('REFRESH')?'refresh':sql.startsWith('SELECT')?'select':'other';
     console.warn(JSON.stringify({component:'zetaris_bridge',phase:'sql_execution',operation,httpStatus:result.status}));throw Error('Zetaris SQL unavailable');
    }return body;
  }
  const observations=createObservationBridge({execute});
  const server = createServer(async (request, response) => {
    if (!authorizeGateway(request.headers.authorization, key)) { response.writeHead(401).end(); return; }
    const abort=new AbortController();request.once('aborted',()=>abort.abort());response.once('close',()=>{if(!response.writableEnded)abort.abort()});let release,sourceOperation=false;
    try {
      request.setTimeout(10000,()=>{abort.abort();request.destroy()});
      const incoming = []; let incomingBytes = 0;
      const privatePath=new URL(request.url,'http://gateway.local').pathname.startsWith('/private-observations/');
      for await (const chunk of request) { incomingBytes += chunk.byteLength; if (incomingBytes > (privatePath?350000:40000)) { response.writeHead(413).end(); return; } incoming.push(chunk); }
      request.setTimeout(0);
      const input = Buffer.concat(incoming).toString('utf8');
      let body; if (input) { try { body = JSON.parse(input); } catch { response.writeHead(400).end(); return; } }
      const path = new URL(request.url, 'http://gateway.local').pathname;
      const service = validateGatewayRequest(path, request.method, body);
      if (!service) {if(privatePath)console.warn(JSON.stringify({component:'zetaris_bridge',phase:'request_contract',code:path.endsWith('/roundtrip')&&(!Number.isSafeInteger(body?.startedAt)||body.startedAt<=0)?'invalid_start_time':path.endsWith('/roundtrip')&&body.startedAt>Date.now()+60000?'future_start_time':'invalid_envelope'}));response.writeHead(403).end(); return; }
      sourceOperation=service==='observations'||service==='observation-erase';
      release=await limiter.acquire({wait:true,maxWaitMs:service==='observation-erase'?10000:service==='nightshift'?(request.method==='POST'?10000:5000):30000,signal:abort.signal});abort.signal.throwIfAborted();
      if(service==='observations'||service==='observation-erase'){
        const out=service==='observations'?await observations.roundtrip(body,{signal:abort.signal}):await observations.eraseOwner(body.ownerHash);
        response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(out));return;
      }
      const headers = { 'Content-Type': 'application/json' };
      if (service === 'zetaris') { await login(); headers.Authorization = 'Bearer ' + access; headers['X-Org-ID'] = orgId; headers['X-Request-ID'] = body.queryId; }
      else { headers.Authorization = 'Bearer ' + readFileSync(status.nightshiftTokenPath, 'utf8').trim(); headers['meterless-app'] = 'thesis'; headers['meterless-scope'] = 'user'; }
      const origin = service === 'zetaris' ? new URL(status.zetaris.baseUrl).origin : new URL(status.nightshift.baseUrl).origin;
      const upstream = await fetch(origin + path, { method: request.method, headers, body: input || undefined, signal: AbortSignal.any([abort.signal,AbortSignal.timeout(180000)]) });
      if (service === 'zetaris' && upstream.status === 401) { validUntil = 0; access = undefined; }
      const reader = upstream.body.getReader(); let bytes = 0; const chunks = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); throw new Error('Upstream response exceeded limit'); } chunks.push(Buffer.from(value)); }
      response.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',...(upstream.headers.get('retry-after')?{'Retry-After':upstream.headers.get('retry-after')}:{}) , ...(upstream.headers.get('x-meterless-receipt-id') ? { 'x-meterless-receipt-id': upstream.headers.get('x-meterless-receipt-id') } : {}) });
      response.end(Buffer.concat(chunks));
    } catch(error) {
      if(sourceOperation){const known={'Observation predates owner erasure':'owner_erasure_fence','Owner was erased during observation':'owner_erasure_race','Zetaris owner-scoped observation count mismatch':'sql_row_count','Zetaris observation identity mismatch':'sql_identity','Zetaris payload mismatch':'sql_payload_integrity','Operator staging failed':'file_stage','Operator staging unavailable':'file_stage','Zetaris SQL unavailable':'sql_execution','Zetaris authentication unavailable':'authentication'};const code=error instanceof GatewayAdmissionError?'admission_capacity_or_timeout':error?.name==='AbortError'?'client_aborted':known[error?.message]??'source_operation_unavailable';console.warn(JSON.stringify({component:'zetaris_bridge',phase:'source_operation',code}))}
      if(!response.destroyed){if (!response.headersSent) response.writeHead(error instanceof GatewayAdmissionError?error.status:502, { 'Content-Type': 'application/json',...(error instanceof GatewayAdmissionError?{'Retry-After':'2'}:{}) }); response.end('{"error":"Local research services are unavailable. Check the operator service connection before trying again."}');}
    }
    finally { release?.(); }
  });
  server.listen(Number(process.env.PORT || 5197), '127.0.0.1', () => console.log('Thesis provider gateway listening on loopback. Request contents and credentials are not logged.'));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startGateway();
