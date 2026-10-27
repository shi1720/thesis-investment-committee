/** Operator-only provisioning for the isolated Thesis namespace. Never imported by application routes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchZetarisStocks, serverUrl, type ProviderEnv } from '../lib/providers';
import { requestJson } from '../lib/providers/http';

function statements(text:string):string[]{
  const result:string[]=[];let current='',quote='',line=false,block=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(line){if(ch==='\n'){line=false;current+='\n'}continue}
    if(block){if(ch==='*'&&next==='/'){block=false;i++}continue}
    if(quote){current+=ch;if(ch===quote){if(next===quote){current+=next;i++}else quote=''}continue}
    if(ch==='-'&&next==='-'){line=true;i++;continue}
    if(ch==='/'&&next==='*'){block=true;i++;continue}
    if(['\'','"','`'].includes(ch)){quote=ch;current+=ch;continue}
    if(ch===';'){if(current.trim())result.push(current.trim());current='';continue}
    current+=ch;
  }
  if(quote||block)throw new Error('Registration SQL contains an unterminated literal or comment.');
  if(current.trim())result.push(current.trim());return result;
}
async function main(){
  const env=process.env as ProviderEnv;
  if(!env.ZETARIS_BASE_URL||!env.ZETARIS_API_KEY||!env.ZETARIS_ORG_ID)throw new Error('Set Zetaris server environment credentials before provisioning.');
  const base=serverUrl(env.ZETARIS_BASE_URL,'Zetaris').toString().replace(/\/$/,'');
  const mode=env.ZETARIS_API_MODE??'proxy';if(!['direct','proxy'].includes(mode))throw new Error('Unknown Zetaris API mode.');
  const sqlPath=path.resolve('data/zetaris/register.sql');
  const sql=await fs.readFile(sqlPath,'utf8');
  const commands=statements(sql);
  for(const command of commands){
    if(!/^CREATE (?:LIGHTNING DATABASE thesis_(?:prices|fundamentals|filings)\b|LIGHTNING FILESTORE TABLE records FROM thesis_(?:prices|fundamentals|filings)\b|SCHEMASTORE CONTAINER thesis\b|SCHEMASTORE VIEW research_universe WITH CONTAINER thesis\b)/i.test(command))throw new Error('Registration file contains an unexpected namespace or statement.');
  }
  const containerArg=process.argv.indexOf('--stage-container');
  if(containerArg>=0){
    const container=process.argv[containerArg+1];if(!container||!/^[A-Za-z0-9_.-]+$/.test(container))throw new Error('A valid explicit driver container name is required.');
    const exec=promisify(execFile);
    await exec('docker',['exec',container,'mkdir','-p','/home/zetaris/customer-data/shared/thesis']);
    for(const file of ['prices.json','fundamentals.csv','filings.json'])await exec('docker',['cp',path.resolve('data/zetaris',file),`${container}:/home/zetaris/customer-data/shared/thesis/${file}`]);
    console.log(JSON.stringify({stagedFiles:3,container}));
  }
  const executed:{statement:number;action:'created'|'already_exists'}[]=[];
  for(let i=0;i<commands.length;i++){
    const queryId=crypto.randomUUID();const body=mode==='direct'?{queryId,sql:commands[i],source:'SqlEditor',limit:20}:{sql:commands[i],limit:20,...(env.ZETARIS_ENGINE_ID?{engineId:env.ZETARIS_ENGINE_ID}:{})};
    // Mutations are never retried automatically: inspect server state after an ambiguous failure.
    const response=await fetch(base+(mode==='direct'?'/sql-editor/sqls/run':'/api/proxy/sql-editor/sqls/run-query'),{method:'POST',headers:{Authorization:`Bearer ${env.ZETARIS_API_KEY}`,'X-Org-ID':env.ZETARIS_ORG_ID,'X-Request-ID':queryId,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
    const text=await response.text();
    const already=/already exist|already registered|duplicate database|duplicate container/i.test(text);
    if(!response.ok && !already)throw new Error(`Registration statement ${i+1} failed with HTTP${response.status}. Inspect the isolated Zetaris SQL workspace before rerunning.`);
    let out:unknown;try{out=JSON.parse(text)}catch{if(!already)throw new Error(`Registration statement ${i+1} returned non-JSON.`)}
    const object=out&&typeof out==='object'?out as Record<string,unknown>:{};
    if((object.error||object.errorMessage||String(object.status??'').toLowerCase()==='error')&&!already)throw new Error(`Registration statement ${i+1} reported a server error. Inspect the isolated SQL workspace.`);
    executed.push({statement:i+1,action:already?'already_exists':'created'});
    console.log(JSON.stringify(executed.at(-1)));
  }
  const stocks=await fetchZetarisStocks({...env,ZETARIS_ALLOW_SAMPLE_DATA:'true'});
  const counts=Object.fromEntries(['US','India','China','UAE'].map(m=>[m,stocks.filter(s=>s.market===m).length]));
  if(stocks.length!==20||Object.values(counts).some(c=>c!==5)||stocks.some(s=>s.prices.length!==505||s.evidence.some(e=>!e.sample)))throw new Error('Queried universe does not match the expected synthetic fixture manifest.');
  const files:Record<string,{sha256:string;bytes:number}>={};
  for(const name of ['prices.json','fundamentals.csv','filings.json','register.sql']){const b=await fs.readFile(path.resolve('data/zetaris',name));files[name]={sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length}}
  const proof={schema:'thesis.zetaris.live-proof.v1',testedAt:new Date().toISOString(),provider:'Zetaris',apiMode:mode,syntheticInputs:true,notice:'Real Zetaris source registration and query over fabricated research fixtures; not live financial observations.',statements:executed,view:'thesis.research_universe',sourceFiles:files,stockCount:stocks.length,marketCounts:counts,priceObservationsPerStock:505,contractValidated:true,symbols:stocks.map(s=>s.symbol),limitations:['This proof establishes delivery and schema validation, not financial correctness or a live market-data license.','Three file feeds are federated; these files simulate independent systems.']};
  await fs.mkdir('evidence',{recursive:true});await fs.writeFile(path.resolve('evidence/zetaris-live.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({success:true,proof:'evidence/zetaris-live.json',stockCount:stocks.length,marketCounts:counts}));
}
main().catch(error=>{console.error(JSON.stringify({success:false,error:error instanceof Error?error.message:'Sponsor provisioning failed.'}));process.exitCode=1});
