import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../lib/contracts';
import { sampleUniverse } from '../lib/research/sample-data';
import { runResearch } from '../lib/research/engine';
import { getProviderStatuses, ProviderError } from '../lib/providers/config';
import { NightshiftClient, normalizeNightshiftUrl } from '../lib/providers/nightshift';
import { ZetarisClient, extractRows } from '../lib/providers/zetaris';
import { HMEM, recallResearchMemory, rememberResearch, rememberPreference } from '../lib/providers/hmem';

const stockEnv={ZETARIS_BASE_URL:'https://zetaris.example.test',ZETARIS_API_KEY:'test-only-token',ZETARIS_ORG_ID:'1',ZETARIS_ALLOW_SAMPLE_DATA:'true'};
const modelEnv={NIGHTSHIFT_BASE_URL:'http://127.0.0.1:8088/v1',NIGHTSHIFT_API_KEY:'test-only-token'};
const fetcher=(fn:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>)=>fn as typeof fetch;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('Nightshift canonical URLs never append duplicate v1 and reject credential URLs',()=>{
  for(const suffix of ['','/','/v1','/v1/models','/v1/chat/completions','/healthz'])assert.equal(normalizeNightshiftUrl('127.0.0.1:8088'+suffix),'http://127.0.0.1:8088/v1');
  assert.throws(()=>normalizeNightshiftUrl('https://token:secret@example.test'),/requires HTTPS/);
  assert.throws(()=>normalizeNightshiftUrl('http://public.example.test'),/requires HTTPS/);
});

test('Nightshift auth rejection is not confused with offline',async()=>{
  const client=new NightshiftClient(modelEnv,fetcher(async()=>json({},401)));
  assert.equal((await client.health()).status,'unauthorized');
  await assert.rejects(()=>client.complete('Skeptic','review','facts'),(e:unknown)=>e instanceof ProviderError&&e.code==='unauthorized');
});

test('Nightshift requires routing modes for online and preserves unknown modes',async()=>{
  const client=new NightshiftClient(modelEnv,fetcher(async()=>json({data:[{id:'meterless/future-route'},{id:'local-runtime/model'}]})));
  assert.deepEqual(await client.health(),{status:'online',models:['meterless/future-route','local-runtime/model']});
});

test('Nightshift attaches app/scope auth and exposes actual model receipt',async()=>{
  const client=new NightshiftClient(modelEnv,fetcher(async(url,init)=>{
    assert.equal(url,'http://127.0.0.1:8088/v1/chat/completions');
    const headers=init?.headers as Record<string,string>;
    assert.equal(headers['meterless-app'],'thesis');assert.equal(headers['meterless-scope'],'user');assert.equal(headers.Authorization,'Bearer test-only-token');
    const request=JSON.parse(init?.body as string);assert.equal(typeof request.messages[1].content,'string');
    return json({id:'proof-1',model:'nvidia/nemotron-test',choices:[{message:{content:'plain string'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:3}});
  }));
  const out=await client.complete('Skeptic','review','facts');assert.equal(out.content,'plain string');assert.equal(out.receipt.nvidiaVerified,true);assert.equal(out.receipt.resolvedModel,'nvidia/nemotron-test');assert.equal(out.receipt.providerCostUsd,null);
});

test('routing alias alone never proves actual model or NVIDIA execution',async()=>{
  const client=new NightshiftClient(modelEnv,fetcher(async()=>json({id:'proof-alias',model:'meterless/auto',choices:[{message:{content:'hello'},finish_reason:'stop'}]})));
  const out=await client.complete('Skeptic','review','facts');assert.equal(out.receipt.resolvedModel,null);assert.equal(out.receipt.nvidiaVerified,false);
});

test('review evaluator rejects foreign citations and delegates one bounded repair',async()=>{
  const run=await runResearch(defaultProfile,{id:'provider-fixture'});
  const candidates=run.opportunities.filter(o=>o.status!=='excluded').slice(0,3);let calls=0;
  const client=new NightshiftClient(modelEnv,fetcher(async()=>{
    calls++;return json({model:'local-runtime/test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify({critiques:candidates.map(c=>({symbol:c.symbol,bullCase:'The supplied thesis merits further investigation.',bearCase:'The stated risk could weaken this research case.',invalidation:'Review if the stated business catalyst fails to materialize.',evidenceIds:calls===1?['foreign-id']:c.evidence.map(e=>e.id)}))})}}]});
  }));
  const out=await client.critiqueResearch(run);assert.equal(calls,2);assert.equal(out.receipts.length,2);assert.equal(out.warnings.length,1);
});

test('Zetaris proxy reads real endpoint with org-scoped headers and validates every stock',async()=>{
  const client=new ZetarisClient(stockEnv,fetcher(async(url,init)=>{
    assert.equal(url,'https://zetaris.example.test/api/proxy/sql-editor/sqls/run-query');
    const body=JSON.parse(init?.body as string);assert.match(body.sql,/FROM thesis.research_universe WHERE market IN \('US'\)/);assert.equal(body.limit,1000);
    assert.equal((init?.headers as Record<string,string>)['X-Org-ID'],'1');
    return json({data:sampleUniverse.filter(s=>s.market==='US')});
  }));
  assert.equal((await client.stocks(['US'])).length,5);
  await assert.rejects(()=>client.query('DELETE FROM thesis.research_universe'),/read-only/);
  await assert.rejects(()=>client.query('SELECT 1; DROP TABLE users'),/read-only/);
});

test('Zetaris direct uses documented SQL Editor contract and refuses untyped rows',async()=>{
  const client=new ZetarisClient({...stockEnv,ZETARIS_BASE_URL:'http://localhost:8888/api/v1.0',ZETARIS_API_MODE:'direct'},fetcher(async(url,init)=>{
    assert.equal(url,'http://localhost:8888/api/v1.0/sql-editor/sqls/run');assert.equal(JSON.parse(init?.body as string).source,'SqlEditor');return json({data:[{symbol:'X',price:'untyped'}]});
  }));
  await assert.rejects(()=>client.stocks(),/contract failed/);
  assert.deepEqual(extractRows({columns:[{name:'symbol'},{name:'price'}],data:[['X',10]]}),[{symbol:'X',price:10}]);
  assert.throws(()=>extractRows({data:[['X',10]]}),/named columns/);
});

test('Zetaris cannot inject SQL through configured view and never silently drops invalid rows',async()=>{
  const bad=new ZetarisClient({...stockEnv,ZETARIS_STOCKS_VIEW:'thesis.stocks; DROP TABLE users'},fetcher(async()=>json([])));
  await assert.rejects(()=>bad.stocks(),/qualified SQL identifier/);
  const mixed=new ZetarisClient(stockEnv,fetcher(async()=>json([sampleUniverse[0],{symbol:'BAD'}])));
  await assert.rejects(()=>mixed.stocks(),/No unvalidated stocks/);
});

test('official Meterless H-MEM works as an actual feature: persistence, recall and append-only audit',async()=>{
  const run=await runResearch(defaultProfile,{id:'hmem-source',now:new Date('2026-10-27T00:00:00Z')});
  const first=rememberResearch(run);assert.ok(first.state.records.length>0);assert.ok(first.ledger.some(l=>l.action==='create'));
  const second=recallResearchMemory(defaultProfile,[],JSON.parse(JSON.stringify(first)));
  assert.equal(second.reused,true);assert.ok(second.lessons.some(l=>l.includes('Historic research decision')));assert.ok(second.context.includes('[MEMORY CONTEXT]'));
  assert.ok(second.snapshot.ledger.length>first.ledger.length);assert.deepEqual(second.snapshot.ledger.slice(0,first.ledger.length),JSON.parse(JSON.stringify(first.ledger)));
  assert.ok(second.trace.scores);
});

test('H-MEM source requirement, exact feedback delta and supersession preserve provenance',()=>{
  const hmem=new HMEM({clock:()=>1000});assert.throws(()=>hmem.add({content:'No evidence',source:''}),/no source/);
  const m=hmem.add({content:'Investment volatility tolerance is conservative',source:'user:mandate',confidence:0.8});hmem.feedback(m.id,'wrong');assert.ok(Math.abs(hmem.store.get(m.id)!.confidence-0.6)<1e-9);assert.ok(hmem.store.get(m.id)!.tags.includes('review'));
  const first=rememberPreference('I prefer low volatility investing','user:1');const second=rememberPreference('Actually I prefer moderate volatility investing','user:2',first);
  assert.equal(second.state.records.length,2);assert.equal(second.state.records[0].supersededBy,second.state.records[1].id);assert.equal(second.state.records[1].supersedes,second.state.records[0].id);
});

test('configuration truth does not imply live provider execution',()=>{
  const statuses=getProviderStatuses({...stockEnv,...modelEnv});assert.equal(statuses.find(s=>s.name==='Zetaris')?.status,'configured');assert.equal(statuses.find(s=>s.name==='NVIDIA Nemotron')?.status,'unavailable');assert.equal(statuses.find(s=>s.name==='Meterless H-MEM')?.status,'verified');
});

test('policy abstention makes zero paid narrative requests even if watch candidates exist',async()=>{
  const run=await runResearch({...defaultProfile,targetReturn:30,maxVolatility:10,maxDrawdown:10},{id:'no-paid-conflict'});
  let calls=0;const client=new NightshiftClient(modelEnv,fetcher(async()=>{calls++;throw Error('must not be called')}));
  const out=await client.critiqueResearch(run);assert.equal(run.abstained,true);assert.equal(calls,0);assert.deepEqual(out.receipts,[]);
});

test('connected synthetic data needs explicit opt-in and cannot mix with real evidence',async()=>{
  const noGate=new ZetarisClient({...stockEnv,ZETARIS_ALLOW_SAMPLE_DATA:undefined},fetcher(async()=>json([sampleUniverse[0]])));
  await assert.rejects(()=>noGate.stocks(),/explicit ZETARIS_ALLOW_SAMPLE_DATA/);
  const mixed=structuredClone(sampleUniverse[0]);mixed.evidence[1].sample=false;
  const client=new ZetarisClient(stockEnv,fetcher(async()=>json([mixed])));
  await assert.rejects(()=>client.stocks(),/cannot mix/);
});

test('failed model validation retains every received generation receipt',async()=>{
  const run=await runResearch(defaultProfile,{id:'failed-model-receipts'});let calls=0;
  const client=new NightshiftClient(modelEnv,fetcher(async()=>{calls++;return json({model:'local-runtime/test',id:'received-'+calls,choices:[{finish_reason:'stop',message:{content:'{"critiques":[]}'}}],usage:{prompt_tokens:100,completion_tokens:10}})}));
  await assert.rejects(()=>client.critiqueResearch(run),(error:unknown)=>{
    const e=error as {receipts?:{requestId:string;inputTokens:number}[]};assert.equal(e.receipts?.length,2);assert.deepEqual(e.receipts?.map(r=>r.requestId),['received-1','received-2']);return true;
  });assert.equal(calls,2);
});

test('truncated generation still retains its billed response metadata',async()=>{
  const run=await runResearch(defaultProfile,{id:'truncated-model'});
  const client=new NightshiftClient(modelEnv,fetcher(async()=>json({model:'local-runtime/test',id:'truncated',choices:[{finish_reason:'length',message:{content:'{"critiques":['}}],usage:{prompt_tokens:100,completion_tokens:1050}})));
  await assert.rejects(()=>client.critiqueResearch(run),(error:unknown)=>{const e=error as {receipts?:{outputTokens:number}[]};assert.equal(e.receipts?.length,1);assert.equal(e.receipts?.[0].outputTokens,1050);return true});
});

test('cross-stock mixed synthetic and actual universe is refused',async()=>{
  const actual=structuredClone(sampleUniverse[1]);for(const e of actual.evidence){e.sample=false;e.url='https://example.test/evidence/'+e.id}
  const client=new ZetarisClient(stockEnv,fetcher(async()=>json([sampleUniverse[0],actual])));
  await assert.rejects(()=>client.stocks(),/universe cannot mix/);
});

test('H-MEM retained context stays bounded and old audit history is exported before rotation',async()=>{
  const run=await runResearch(defaultProfile,{id:'retention-template'});
  let stored=rememberResearch(run);let archivedEntries=0,archivedRecords=0;
  for(let i=0;i<140;i++){
    stored=rememberResearch({...run,id:'retention-'+i},stored);
    assert.ok(stored.state.records.length<=256);assert.ok(stored.ledger.length<=512);
    // Model the service's atomic durable archive + clean snapshot transaction.
    archivedEntries+=stored.pendingArchive?.entries.length??0;archivedRecords+=stored.pendingArchive?.evictedRecords.length??0;
    delete stored.pendingArchive;
  }
  assert.ok(archivedEntries>0);assert.ok(archivedRecords>0);assert.equal(stored.retention?.totalEvictedRecords,archivedRecords);assert.equal(stored.retention?.totalArchivedAuditEntries,archivedEntries);
});

test('valid citations cannot launder invented numerical claims or a forecast into narratives',async()=>{
  const run=await runResearch(defaultProfile,{id:'invented-claim'});
  const candidates=run.opportunities.filter(o=>o.status!=='excluded').slice(0,3);let calls=0;
  const client=new NightshiftClient(modelEnv,fetcher(async()=>{
    calls++;return json({model:'local-runtime/test',id:'invented-'+calls,choices:[{finish_reason:'stop',message:{content:JSON.stringify({critiques:candidates.map(c=>({symbol:c.symbol,bullCase:'Revenue rose 973% and this stock will triple.',bearCase:'The supplied risks warrant further investigation.',invalidation:'Review the thesis if the stated catalyst weakens.',evidenceIds:c.evidence.map(e=>e.id)}))})}}],usage:{prompt_tokens:100,completion_tokens:100}});
  }));
  await assert.rejects(()=>client.critiqueResearch(run),/failed schema or evidence checks/);assert.equal(calls,2);
});

test('provider streaming response is cancelled at the byte limit before unbounded buffering',async()=>{
  const {requestJson}=await import('../lib/providers/http');
  let produced=0,cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(controller){produced++;controller.enqueue(new Uint8Array(65536));if(produced===100)controller.close()},cancel(){cancelled=true}});
  await assert.rejects(()=>requestJson('Zetaris','https://example.test',{}, {fetcher:fetcher(async()=>new Response(stream)),attempts:1}),/bounded payload limit/);
  assert.equal(cancelled,true);assert.ok(produced<100);
});

test('optional independent auditor adds an evidence-linked observation without changing a risk veto',async()=>{
  const run=await runResearch(defaultProfile,{id:'independent-auditor'});
  const chosen=run.opportunities.filter(o=>o.status==='excluded'&&o.metrics.some(m=>!m.passed)).sort((a,b)=>b.score-a.score)[0];
  const before=JSON.stringify(run.opportunities.map(o=>({symbol:o.symbol,status:o.status,metrics:o.metrics})));
  const client=new NightshiftClient({...modelEnv,NIGHTSHIFT_AUDITOR_MODEL:'local-runtime/nemotron-test'},fetcher(async(_url,init)=>{
    assert.equal(JSON.parse(init?.body as string).model,'local-runtime/nemotron-test');
    return json({model:'local-runtime/nemotron-test',id:'audit-proof',choices:[{finish_reason:'stop',message:{content:JSON.stringify({symbol:chosen.symbol,decision:'request_review',reasonCode:'synthetic_evidence',observation:'Synthetic demonstration figures require verified source filings before any research conclusion is used.',evidenceIds:[chosen.evidence.find(e=>e.kind==='prices')!.id]})}}]});
  }));
  const audit=await client.auditExclusion(run);assert.equal(audit?.decision,'request_review');assert.equal(audit?.receipts[0].nvidiaVerified,true);assert.equal(JSON.stringify(run.opportunities.map(o=>({symbol:o.symbol,status:o.status,metrics:o.metrics}))),before);
});

test('qualitative guard rejects written-out forecasts while permitting conditional business mechanisms',async()=>{
  const {narrativeIssues}=await import('../lib/providers/nightshift');
  const value={symbol:'X',bullCase:'This stock will triple.',bearCase:'The operating risks merit research.',invalidation:'Review the source evidence if the catalyst weakens.',evidenceIds:['source']};
  assert.ok(narrativeIssues(value).length>0);
  assert.ok(narrativeIssues({...value,bullCase:'The expected return is exceptional.'}).length>0);
  assert.deepEqual(narrativeIssues({...value,bullCase:'The business may benefit from enterprise demand if execution remains sound.'}),[]);
});

test('public actual-data proof uses an allowlist and cannot disclose nested financial records or prompts',async()=>{
  const {publicSponsorProof}=await import('../lib/providers/proof');
  const privateText='PRIVATE_FINANCIAL_RECORD_ABC';
  const input={startedAt:'2026-10-27T00:00:00Z',finishedAt:'2026-10-27T00:00:01Z',syntheticInputs:false,dataProvider:'Zetaris',stockCount:1,sourceRowsValidated:true,profile:{capital:99912345},prices:[123456.789],narrative:privateText,receipts:[{provider:'Meterless Nightshift' as const,role:privateText,requestedModel:'meterless/auto',responseModel:'local-runtime/test',resolvedModel:'local-runtime/test',nvidiaVerified:false,requestId:'req-1',receiptId:'rcpt-1',latencyMs:100,inputTokens:20,outputTokens:10,providerCostUsd:0,attempts:1,routedProvider:privateText,receiptBody:{prompt_preview:privateText,prices:[123456.789],profile:{capital:99912345}}}]};
  const out=publicSponsorProof(input);const serialized=JSON.stringify(out);
  assert.equal(out.dataMode,'actual_private');assert.equal(out.counts.stocks,1);assert.equal(out.receipts[0].resolvedModel,'local-runtime/test');assert.equal(out.receipts[0].providerCostUsd,0);
  for(const hidden of [privateText,'99912345','123456.789','\"prompt_preview\":','\"receiptBody\":','\"profile\":','\"narrative\":'])assert.equal(serialized.includes(hidden),false);
  assert.equal('research' in out,false);
});

test('Zetaris verified native headers map tabular rows and reject duplicate column identities',()=>{
  assert.deepEqual(extractRows({headers:['symbol','price'],data:[['X',10]],total:1}),[{symbol:'X',price:10}]);
  assert.throws(()=>extractRows({headers:['symbol','symbol'],data:[['X','Y']]}),/named columns/);
});

test('native Zetaris numeric strings normalize only fixed finite numerical columns',async()=>{
  const stock=structuredClone(sampleUniverse[0]) as unknown as Record<string,unknown>;
  for(const field of ['price','annualReturn','annualVolatility','maxDrawdown','revenueGrowth','operatingMargin','debtToEquity','pe','dividendYield','marketCapBn','quality'])stock[field]=String(stock[field]);
  stock.prices=JSON.stringify(stock.prices);stock.evidence=JSON.stringify(stock.evidence);
  const client=new ZetarisClient(stockEnv,fetcher(async()=>json({headers:Object.keys(stock),data:[Object.values(stock)]})));
  const parsed=await client.stocks();assert.equal(parsed[0].price,sampleUniverse[0].price);assert.equal(parsed[0].quality,sampleUniverse[0].quality);
  for(const invalid of ['', 'null', 'NaN', 'Infinity', '1e999', '$42.00', '1,234.50']){
    const bad=new ZetarisClient(stockEnv,fetcher(async()=>json([{...stock,price:invalid}])));
    await assert.rejects(()=>bad.stocks(),/contract failed at price/);
  }
});

test('cross-market ticker collisions fail closed before symbol-only downstream association',async()=>{
  const first=structuredClone(sampleUniverse[0]);
  const second={...structuredClone(first),market:'India' as const,exchange:'NSE',currency:'INR',evidence:first.evidence.map(e=>({...e,id:e.id+'-other-listing'}))};
  assert.notDeepEqual(first.evidence.map(e=>e.id),second.evidence.map(e=>e.id));
  const client=new ZetarisClient(stockEnv,fetcher(async()=>json([first,second])));
  await assert.rejects(()=>client.stocks(),/globally unique exchange-qualified symbol codes/);
});
