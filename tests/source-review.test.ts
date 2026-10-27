import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceReviewService} from '../server/platform/source-review';
import {getCachedSecFundamentals} from '../server/platform/sec-fundamentals';
import type {ProviderResult} from '../lib/finance/contracts';
import type {ModelReceipt} from '../lib/providers/nightshift';
import type {ZetarisLayerReceipt} from '../server/platform/zetaris-layer';
const instrument={symbol:'AAPL',market:'US' as const,exchange:'NASDAQ',currency:'USD'};
const unavailable={status:'unavailable' as const,data:null,provenance:{provider:'user' as const,fetchedAt:new Date().toISOString(),asOf:null,sourceUrl:'https://example.test/no-source',currency:'USD',timezone:null,adjustment:'unknown' as const,delay:'unknown' as const},warnings:['No market source in this isolated contract test.']};
const layer:ZetarisLayerReceipt={provider:'Zetaris',status:'verified',actual:true,queriedAt:new Date().toISOString(),sourceAsOf:'2026-07-31',message:'Mock transport only, not a live integration proof.'};
const roundtrip=async<T extends ProviderResult<unknown>>(_owner:string,_kind:unknown,value:T)=>({...value,dataLayer:{...layer,...(value.data===null?{status:'not_applicable' as const,actual:false}:{})}});
function receipt(model:string,role:string):ModelReceipt{return{provider:'Meterless Nightshift',role,requestedModel:model,responseModel:model,resolvedModel:model,nvidiaVerified:true,requestId:crypto.randomUUID(),latencyMs:1,inputTokens:100,outputTokens:30,providerCostUsd:0,receiptId:null,attempts:1,routedProvider:'local-runtime',receiptBody:null}}
function service(options:{invalid?:boolean;wrongModel?:boolean;fail?:boolean;noFacts?:boolean;wrongIssuer?:boolean;badGap?:boolean;badCitation?:boolean}={}){
 let calls=0;const complete=async(model:string,role:'planner'|'skeptic',_system:string,prompt:string,format?:{name:string;schema:unknown})=>{calls++;if(options.fail)throw Error('must-not-leak-secret');const supplied=JSON.parse(prompt.split('\n')[0]);const schema=format?.schema as {properties:{evidenceIds:{items:{enum:string[]}}}};assert.deepEqual(schema.properties.evidenceIds.items.enum,supplied.sources.map((e:{id:string})=>e.id));return{content:JSON.stringify({coverage:options.invalid?'market_data_complete':'fundamentals_only',blockingGap:options.badGap?'fundamentals':'quote',evidenceIds:[options.badCitation?'not-supplied':supplied.sources[0].id]}),receipt:{...receipt(model,role),...(options.wrongModel?{resolvedModel:'some-other-model',nvidiaVerified:false}:{})}}};
 const run=createSourceReviewService({quote:async()=>unavailable,history:async()=>unavailable,fundamentals:()=>options.noFacts?null:getCachedSecFundamentals(options.wrongIssuer?{...instrument,symbol:'MSFT'}:instrument),roundtrip,memory:async()=>({context:'Historical user decision context only. Never current evidence.\nPrior source review: history missing. apiKey=must-redact-value',reused:true,count:1}),complete}).run;
 return{run,calls:()=>calls};
}
test('source-review contract preserves missing quote/history, uses one model countercheck after deterministic planning, and exposes source IDs/usage',async()=>{
 const s=service(),out=await s.run('test-owner',{instrument});assert.equal(out.status,'completed');assert.equal(out.findings.length,0);assert.deepEqual(out.sourceAudit.missing,['quote','history']);assert.equal(out.sourceAudit.decision,'missing_market_evidence');assert.equal(out.sourceAudit.modelDiversity,false);assert.equal(s.calls(),1);assert.equal(out.receipts.length,1);assert.ok(out.receipts.every(r=>r.responseModel?.includes('nemotron')));assert.equal(out.budget.knownTokens,130);assert.equal(out.sourceAudit.planning,'deterministic_source_plan');assert.equal(out.sourceAudit.modelPasses,1);assert.equal('analyst' in out.sourceAudit,false);assert.ok(out.stages[0].summary.includes('Deterministic code'));assert.ok(out.evidence.every(e=>e.source==='SEC'));assert.ok(out.evidence.every(e=>(e.content as {dataMode:string}).dataMode==='cached_snapshot'));assert.equal(out.memory.reused,true);assert.ok(out.memory.context.startsWith('Historical only:'));assert.ok(out.memory.context.includes('history missing'));assert.ok(out.memory.context.length<=200);assert.equal(out.memory.context.includes('must-redact-value'),false);assert.ok(out.risks.some(r=>r.includes('historical decision')));
});
test('incorrect coverage cannot override deterministic source gaps; repairs are bounded and receipts retained',async()=>{
 const s=service({invalid:true}),out=await s.run('test-owner',{instrument});assert.equal(out.status,'incomplete');assert.equal(out.sourceAudit.decision,'missing_market_evidence');assert.equal(s.calls(),2);assert.equal(out.receipts.length,2);assert.ok(out.receipts.every(r=>r.status==='invalid_output'));assert.equal(out.receipts[0].validationIssues?.[0].path,'coverage');assert.equal(out.sourceAudit.critic,null);
});
test('a substituted response model never counts as a verified NVIDIA source audit',async()=>{
 const s=service({wrongModel:true}),out=await s.run('test-owner',{instrument});assert.equal(out.status,'incomplete');assert.equal(s.calls(),2);assert.ok(out.receipts.every(r=>r.status==='invalid_output'));
});
test('missing or wrong-instrument fundamentals do not become investment evidence or trigger model calls',async()=>{
 for(const options of [{noFacts:true},{wrongIssuer:true}]){const s=service(options),out=await s.run('test-owner',{instrument});assert.equal(out.evidence.length,0);assert.equal(out.status,'incomplete');assert.equal(s.calls(),0);assert.equal(out.error?.code,'source_unavailable')}
});
test('model transport failures persist an unknown-cost error receipt without leaking upstream messages',async()=>{
 const s=service({fail:true}),out=await s.run('test-owner',{instrument});assert.equal(out.status,'incomplete');assert.equal(out.receipts.length,1);assert.equal(out.receipts[0].status,'failed');assert.equal(out.receipts[0].reportedCostUsd,null);assert.equal(out.budget.unknownUsageCalls,1);assert.equal(JSON.stringify(out).includes('must-not-leak-secret'),false);
});

test('single-model source check still rejects a currently present gap and citations outside the dynamic enum',async()=>{
 for(const options of [{badGap:true},{badCitation:true}]){const s=service(options),out=await s.run('test-owner',{instrument});assert.equal(out.status,'incomplete');assert.equal(s.calls(),2);assert.equal(out.sourceAudit.decision,'missing_market_evidence');assert.ok(out.receipts.every(r=>r.status==='invalid_output'));assert.equal(out.receipts[0].validationIssues?.[0].path,options.badGap?'blockingGap':'evidenceIds')}
});
