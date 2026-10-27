import test from 'node:test';
import assert from 'node:assert/strict';
import {roundTripFinancialObservation,eraseZetarisObservations} from '../server/platform/zetaris-layer';
import {createObservationBridge,validateGatewayRequest} from '../scripts/provider-gateway.mjs';
import {canonicalObservation,validateObservationRequest,observationNames} from '../scripts/observation-contract.mjs';
const env={THESIS_ZETARIS_LAYER_URL:'https://gateway.example.test',THESIS_ZETARIS_LAYER_KEY:'test-only-bridge-secret',THESIS_ZETARIS_LAYER_REQUIRED:'true'};
/** Synthetic contract fixtures are never staged in the live sponsor proof. */
const observation=()=>({status:'partial' as const,data:{instrument:{symbol:'TEST',market:'US',currency:'USD'},metrics:{pe:{value:null,unit:'ratio',period:null},eps:{value:1.25,unit:'currency',period:'2025-12-31'}}},provenance:{provider:'SEC' as const,fetchedAt:'2026-10-27T00:00:00Z',asOf:'2025-12-31',sourceUrl:'https://www.sec.gov/Archives/contract-fixture',currency:'USD',timezone:null,adjustment:'unknown' as const,delay:'unknown' as const},warnings:['Historical test fixture; not an actual source proof.'],factEvidence:[{id:'fixture-fact',value:1.25}],filings:[]});
const fences=()=>{const values=new Map<string,number>();return {get:async(owner:string)=>values.get(owner)??0,set:async(owner:string,at:number)=>{values.set(owner,at)}}};
const fetcher=(fn:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>)=>fn as typeof fetch;
test('actual-observation roundtrip contract uses fixed owner-derived SQL and preserves nulls/extra SEC fields',async()=>{
 let row:Record<string,unknown>={},statements:string[]=[];const bridge=createObservationBridge({fences:fences(),stage:async(_names:unknown,_key:string,value:Record<string,unknown>)=>{row=value},execute:async(sql:string)=>{statements.push(sql);return sql.startsWith('SELECT')?{headers:['owner_hash','record_key','source_kind','payload_hash','payload_json'],data:[[row.owner_hash,row.record_key,row.source_kind,row.payload_hash,row.payload_json]]}:{headers:[],data:[]}}});
 const original=observation();const out=await roundTripFinancialObservation('private-owner','fundamentals',original,{env,fetcher:fetcher(async(url,init)=>{assert.equal(String(url),'https://gateway.example.test/private-observations/roundtrip');const request=JSON.parse(String(init?.body));assert.equal(String(init?.body).includes('private-owner'),false);assert.equal(String(init?.body).includes('test-only-bridge-secret'),false);return new Response(JSON.stringify(await bridge.roundtrip(request)),{headers:{'content-type':'application/json'}})})});
 assert.equal(out.dataLayer.status,'verified');assert.equal(out.dataLayer.actual,true);assert.deepEqual(out.data,original.data);assert.equal(out.data!.metrics.pe.value,null);assert.deepEqual(out.factEvidence,original.factEvidence);assert.ok(statements.some(sql=>sql.startsWith('CREATE LIGHTNING FILESTORE TABLE')));assert.ok(statements.some(sql=>sql.startsWith('CREATE SCHEMASTORE VIEW')));assert.ok(statements.at(-1)?.includes("WHERE owner_hash = '"));assert.equal(out.provenance.fetchedAt,original.provenance.fetchedAt);
});
test('private delivery is bounded and cannot smuggle synthetic rows credentials SQL or paths',()=>{
 const ownerHash='a'.repeat(64),recordKey='b'.repeat(64);const body={ownerHash,recordKey,startedAt:Date.now(),kind:'fundamentals',envelope:observation()};assert.equal(validateGatewayRequest('/private-observations/roundtrip','POST',body),'observations');
 for(const extra of [{sql:'SELECT * FROM users'},{path:'/etc/passwd'},{ownerHash:'../escape'},{kind:'admin'}])assert.equal(validateObservationRequest({...body,...extra}),false);
 for(const extra of [{apiKey:'private-value'},{synthetic:true},{sample:true},{userId:'owner-id'}])assert.throws(()=>canonicalObservation({...observation(),...extra}));
 assert.throws(()=>canonicalObservation({...observation(),data:{value:Infinity}}));assert.throws(()=>canonicalObservation({...observation(),data:{text:'x'.repeat(350000)}}));
 assert.equal(validateGatewayRequest('/api/v1.0/sql-editor/sqls/run','POST',{queryId:'a1234567-1234-1234-1234-123456789abc',source:'SqlEditor',limit:1000,sql:`SELECT * FROM ${observationNames(ownerHash).view} LIMIT 1000`}),null);
});
test('wrong-owner SQL rows and tampered financial payloads fail closed without SEC side-channel facts',async()=>{
 for(const mismatch of ['owner','payload']){
  let row:Record<string,unknown>={};const bridge=createObservationBridge({fences:fences(),stage:async(_n:unknown,_k:string,value:Record<string,unknown>)=>{row=value},execute:async(sql:string)=>sql.startsWith('SELECT')?{headers:['owner_hash','record_key','source_kind','payload_hash','payload_json'],data:[[mismatch==='owner'?'c'.repeat(64):row.owner_hash,row.record_key,row.source_kind,row.payload_hash,mismatch==='payload'?'{}':row.payload_json]]}:{headers:[],data:[]}});
  const out=await roundTripFinancialObservation('owner','fundamentals',observation(),{env,fetcher:fetcher(async(_url,init)=>{try{return new Response(JSON.stringify(await bridge.roundtrip(JSON.parse(String(init?.body)))))}catch{return new Response('{}',{status:502})}})});
  assert.equal(out.status,'unavailable');assert.equal(out.data,null);assert.deepEqual(out.factEvidence,[]);assert.equal(out.dataLayer.status,'failed');
 }
});
test('unconfigured required mode and network failures never silently return native financial values',async()=>{
 const missing=await roundTripFinancialObservation('owner','fundamentals',observation(),{env:{THESIS_ZETARIS_LAYER_REQUIRED:'true'}});assert.equal(missing.data,null);assert.equal(missing.dataLayer.status,'failed');
 const failed=await roundTripFinancialObservation('owner','fundamentals',observation(),{env,fetcher:fetcher(async()=>{throw Error('private upstream details')})});assert.equal(failed.data,null);assert.equal(JSON.stringify(failed).includes('private upstream'),false);
 const disabled=await roundTripFinancialObservation('owner','fundamentals',observation(),{env:{}});assert.equal(disabled.dataLayer.status,'disabled');assert.equal(disabled.dataLayer.actual,false);
});
test('owner erase deletes staged artifacts and durable tombstone rejects an old operation after restart',async()=>{
 const durable=fences(),ownerHash='d'.repeat(64),recordKey='e'.repeat(64),startedAt=Date.now()-1000;let stages=0,erases=0,row:Record<string,unknown>={};
 const factory=()=>createObservationBridge({fences:durable,stage:async(_names:unknown,_key:string,value:Record<string,unknown>)=>{stages++;row=value},erase:async()=>{erases++;row={}},execute:async(sql:string)=>sql.startsWith('SELECT')?{headers:['owner_hash','record_key','source_kind','payload_hash','payload_json'],data:[[row.owner_hash,row.record_key,row.source_kind,row.payload_hash,row.payload_json]]}:{headers:[],data:[]}});
 const request={ownerHash,recordKey,kind:'fundamentals',envelope:observation(),startedAt};const bridge=factory();await bridge.roundtrip(request);assert.equal(stages,1);const erased=await bridge.eraseOwner(ownerHash);assert.equal(erased.erased,true);assert.equal(erases,1);
 await assert.rejects(()=>factory().roundtrip(request));assert.equal(stages,1);await factory().roundtrip({...request,startedAt:erased.erasedAt+1});assert.equal(stages,2);
});
test('erasure requires a matching owner acknowledgement, not merely an HTTP200',async()=>{
 assert.equal(await eraseZetarisObservations('owner',{env,fetcher:fetcher(async()=>new Response('{"erased":true}'))}),false);
 assert.equal(await eraseZetarisObservations('owner',{env,fetcher:fetcher(async(_url,init)=>new Response(JSON.stringify({erased:true,ownerHash:JSON.parse(String(init?.body)).ownerHash,erasedAt:Date.now()})))}),true);
});

test('delivery diagnostics identify HTTP admission failure without leaking owner, key or upstream body',async()=>{
 const diagnostics:unknown[]=[];const result=await roundTripFinancialObservation('private-owner-id','fundamentals',observation(),{env,onDiagnostic:value=>diagnostics.push(value),fetcher:fetcher(async()=>new Response('{"secret":"do-not-log"}',{status:429}))});assert.equal(result.data,null);assert.deepEqual(diagnostics,[{component:'zetaris_observation',phase:'transport',httpStatus:429}]);assert.equal(JSON.stringify(diagnostics).includes('private-owner-id'),false);assert.equal(JSON.stringify(diagnostics).includes('do-not-log'),false);
});
