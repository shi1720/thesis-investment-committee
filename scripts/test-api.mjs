import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
const base=process.env.THESIS_TEST_URL??'http://127.0.0.1:5188';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw new Error('API tests run on loopback test environments only.');
const trusted=process.env.THESIS_TEST_TRUSTED_HEADERS==='1';
const suffix=crypto.randomUUID();
const identity=trusted?{'oai-authenticated-user-id':'api-test-'+suffix,'oai-authenticated-user-email':'api-test@sites.test'}:{cookie:'__sites_local_auth=1'};
const headers={...identity,'content-type':'application/json',origin:base};
const profile={markets:['US','India'],targetReturn:12,maxVolatility:25,maxDrawdown:25,horizonMonths:36,capital:25000,baseCurrency:'USD',excludedSectors:[],mode:'sample'};
const checks=[]; const created=[];
async function call(path,options={}){const response=await fetch(base+path,{...options,headers:{...headers,...options.headers}});const text=await response.text();let body;try{body=JSON.parse(text)}catch{body={error:text}}return {response,body};}
function ok(name){checks.push(name);console.log('PASS '+name);}
try{
 const guest=await fetch(base+'/api/runs');assert.equal(guest.status,401);ok('guest cannot read personal history');
 const bootstrap=await call('/api/bootstrap');assert.equal(bootstrap.body.user.signedIn,true);assert.equal(bootstrap.body.universe.length,20);ok('authenticated bootstrap exposes all four sample markets');
 const invalid=await call('/api/research',{method:'POST',body:JSON.stringify({...profile,maxVolatility:-1})});assert.equal(invalid.response.status,400);ok('invalid preferences rejected before research');
 const csrf=await call('/api/research',{method:'POST',headers:{origin:'https://untrusted.example'},body:JSON.stringify(profile)});assert.equal(csrf.response.status,403);ok('cross-origin writes rejected');
 const key='api-test-'+suffix;
 const first=await call('/api/research',{method:'POST',headers:{'x-idempotency-key':key},body:JSON.stringify(profile)});assert.equal(first.response.status,201,JSON.stringify(first.body));created.push(first.body.id);
 assert.ok(first.body.opportunities.some(o=>o.status==='qualified'));assert.ok(first.body.opportunities.some(o=>o.status==='excluded'));assert.ok(first.body.events.some(e=>e.agent==='Memory'&&e.model==='Meterless/H-MEM'));ok('real research executes with hard gates and official H-MEM');
 const duplicate=await call('/api/research',{method:'POST',headers:{'x-idempotency-key':key},body:JSON.stringify(profile)});assert.equal(duplicate.body.id,first.body.id);ok('idempotent retry returns original result');
 const conflict=await call('/api/research',{method:'POST',headers:{'x-idempotency-key':key},body:JSON.stringify({...profile,targetReturn:15})});assert.equal(conflict.response.status,409);ok('idempotency key cannot change mandate');
 const existingKeys=new Set(bootstrap.body.watchlist.map(o=>o.market+':'+o.symbol));
 const candidate=first.body.opportunities.find(o=>o.status==='qualified'&&!existingKeys.has(o.market+':'+o.symbol))??first.body.opportunities.find(o=>!existingKeys.has(o.market+':'+o.symbol));
 if(!candidate)throw new Error('All fixture companies already saved. Use an isolated built-Worker test account.');
 const saved=await call('/api/watchlist',{method:'POST',body:JSON.stringify({symbol:candidate.symbol,market:candidate.market,runId:first.body.id,note:'Test thesis note',name:'FORGED NAME'})});assert.equal(saved.response.status,201);assert.equal(saved.body.name,candidate.name);ok('saved thesis uses server-owned research identity');
 const update=await call('/api/watchlist/'+saved.body.id,{method:'PATCH',body:JSON.stringify({note:'Revisit the catalyst in the next filing.'})});assert.equal(update.body.note,'Revisit the catalyst in the next filing.');ok('saved note updates persist');
 const report=await fetch(base+'/api/runs/'+first.body.id+'/report',{headers:identity});const html=await report.text();assert.equal(report.status,200);assert.ok(html.includes('Synthetic sample data'));ok('print-ready research report preserves provenance');
 const unsuitable=await call('/api/research',{method:'POST',body:JSON.stringify({...profile,targetReturn:40,maxVolatility:10,maxDrawdown:10})});assert.equal(unsuitable.response.status,201,JSON.stringify(unsuitable.body));created.push(unsuitable.body.id);assert.equal(unsuitable.body.abstained,true);assert.equal(unsuitable.body.cost.modelCalls,0);ok('conflicting mandate abstains before paid inference');
 if(trusted){const other={'oai-authenticated-user-id':'other-'+suffix,'oai-authenticated-user-email':'other@sites.test'};for(const path of ['/api/runs/'+first.body.id,'/api/runs/'+first.body.id+'/report']){const r=await fetch(base+path,{headers:other});assert.equal(r.status,404);}const r=await fetch(base+'/api/watchlist/'+saved.body.id,{method:'PATCH',headers:{...other,'content-type':'application/json',origin:base},body:JSON.stringify({note:'intrusion'})});assert.equal(r.status,404);ok('a second account cannot read or edit another account records');}
 const exported=await call('/api/account');assert.ok(exported.body.runs.some(r=>r.id===first.body.id));assert.ok(exported.body.watchlist.some(r=>r.id===saved.body.id));ok('account data export contains research and saved notes');
 const remove=await call('/api/watchlist/'+saved.body.id,{method:'DELETE'});assert.equal(remove.body.ok,true);ok('test saved thesis deletion succeeds');
 mkdirSync('evidence',{recursive:true});writeFileSync('evidence/api-tests.json',JSON.stringify({executedAt:new Date().toISOString(),environment:trusted?'local production Worker, synthetic platform identity headers':'local development, synthetic platform account',checks:checks.length,results:checks},null,2)+'\n');
}finally{for(const id of created)await call('/api/runs/'+id,{method:'DELETE'});}
console.log(`${checks.length} API integration checks passed.`);
