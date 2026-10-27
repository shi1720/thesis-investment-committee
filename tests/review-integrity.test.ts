/** Adversarial regression cases discovered during independent backend review. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../lib/contracts';
import { sampleUniverse } from '../lib/research/sample-data';
import { runResearch } from '../lib/research/engine';
import { NightshiftClient } from '../lib/providers/nightshift';
const clock={now:new Date('2026-10-27T00:00:00Z'),id:'review-integrity'};

test('a zero return aspiration is valid and never interpreted as a promised positive forecast',async()=>{
  const run=await runResearch({...defaultProfile,targetReturn:0,maxVolatility:80,maxDrawdown:80},clock);
  assert.ok(run.eligibleCount>0);
  assert.equal(run.profile.targetReturn,0);
  assert.ok(run.opportunities.every(s=>Number.isFinite(s.score)&&s.targetGap>=0));
  assert.ok(run.methodology.some(s=>s.includes('not probabilities')));
  assert.ok(run.opportunities.filter(s=>s.status==='qualified').every(s=>s.metrics.every(m=>m.passed)));
});

test('an all-rejected universe produces a complete abstention dossier and zero model requests',async()=>{
  const run=await runResearch({...defaultProfile,maxVolatility:5,maxDrawdown:5,targetReturn:0},clock);
  assert.equal(run.eligibleCount,0);
  assert.equal(run.abstained,true);
  assert.ok(run.opportunities.length>0);
  assert.ok(run.opportunities.every(s=>s.status==='excluded'));
  assert.ok(run.events.some(e=>e.action==='Branch to abstention'));
  assert.ok(run.events.some(e=>e.agent==='Evaluator'));
  let calls=0;
  const client=new NightshiftClient({NIGHTSHIFT_BASE_URL:'http://127.0.0.1:8088',NIGHTSHIFT_API_KEY:'contract-test-only'},async()=>{calls++;throw new Error('Must not be invoked');});
  const critique=await client.critiqueResearch(run);
  assert.equal(calls,0);
  assert.deepEqual(critique.receipts,[]);
});

test('drawdown alone vetoes a stock even when measured volatility fits',async()=>{
  const stock=sampleUniverse.find(s=>s.symbol==='HDFCBANK')!;
  assert.ok(stock.annualVolatility<25&&stock.maxDrawdown>25);
  const run=await runResearch(defaultProfile,{...clock,stocks:[stock]});
  assert.equal(run.opportunities[0].status,'excluded');
  assert.equal(run.opportunities[0].metrics.find(m=>m.name==='Annualized volatility')?.passed,true);
  assert.equal(run.opportunities[0].metrics.find(m=>m.name==='Historical max drawdown')?.passed,false);
  assert.equal(run.abstained,true);
});

test('ambiguous shared evidence IDs cannot replace another security’s source register entry',async()=>{
  const a=structuredClone(sampleUniverse[0]),b=structuredClone(sampleUniverse[1]);
  a.evidence[1].id='same-filing-id';b.evidence[1].id='same-filing-id';
  const run=await runResearch({...defaultProfile,maxVolatility:80,maxDrawdown:80},{...clock,stocks:[a,b]});
  assert.ok(run.opportunities.every(s=>s.status==='excluded'));
  assert.ok(run.opportunities.every(s=>s.reasons.some(r=>/ambiguous|duplicate|collision/i.test(r))));
  assert.equal(run.evidence.length,4);
  assert.equal(new Set(run.evidence.map(e=>e.id)).size,4);
  assert.equal(run.evidence.filter(e=>e.id.startsWith('conflict-')).length,2);
  assert.ok(run.evidence.some(e=>e.publisher==='Microsoft'));
  assert.ok(run.evidence.some(e=>e.publisher==='Visa'));
});

test('a quote incompatible with the end of its adjusted price history must fail closed',async()=>{
  const stock={...sampleUniverse[0],price:1};
  const run=await runResearch({...defaultProfile,maxVolatility:80,maxDrawdown:80},{...clock,stocks:[stock]});
  assert.equal(run.opportunities[0].status,'excluded');
  assert.ok(run.opportunities[0].reasons.some(r=>/latest|closing|price.*match|inconsistent/i.test(r)));
});


test('identical shared methodology provenance remains valid for multiple companies',async()=>{
  const shared={...sampleUniverse[0].evidence[0],id:'shared-methodology',kind:'methodology' as const,title:'Shared fixture methodology',excerpt:'The exact same synthetic data methodology applies to both securities.'};
  const a={...sampleUniverse[0],evidence:[...sampleUniverse[0].evidence,shared]};
  const b={...sampleUniverse[1],evidence:[...sampleUniverse[1].evidence,structuredClone(shared)]};
  const run=await runResearch({...defaultProfile,maxVolatility:80,maxDrawdown:80},{...clock,stocks:[a,b]});
  assert.equal(run.eligibleCount,2);
  assert.equal(run.evidence.filter(e=>e.id==='shared-methodology').length,1);
  assert.ok(run.opportunities.every(s=>s.status==='qualified'));
});

function datedLiveRecord(priceDate:string,filingDate='2025-06-30') {
  // Contract-only fixture: relabeling here tests validation, not live-data proof.
  const source=structuredClone(sampleUniverse.find(s=>s.symbol==='V')!);
  source.asOf='2026-10-27';
  source.evidence=source.evidence.map(e=>({...e,sample:false,url:`https://example.test/contract-only/${e.kind}`,asOf:e.kind==='prices'?priceDate:filingDate}));
  return source;
}

test('a fresh stock wrapper cannot launder stale underlying live price provenance',async()=>{
  const stock=datedLiveRecord('2010-01-01');
  const run=await runResearch({...defaultProfile,mode:'live'},{...clock,stocks:[stock]});
  assert.equal(run.eligibleCount,0);
  assert.equal(run.abstained,true);
  assert.equal(run.opportunities[0].status,'excluded');
  assert.ok(run.opportunities[0].reasons.some(r=>/price provenance.*45 days/i.test(r)));
});

test('future live price or filing publication dates cannot qualify',async()=>{
  for(const kind of ['prices','filing'] as const){
    const stock=datedLiveRecord('2026-10-27');
    stock.evidence.find(e=>e.kind===kind)!.asOf='2026-10-29';
    const run=await runResearch({...defaultProfile,mode:'live'},{...clock,stocks:[stock]});
    assert.equal(run.opportunities[0].status,'excluded',`${kind} evidence must not be future-dated`);
    assert.ok(run.opportunities[0].reasons.some(r=>r.includes('future-dated')&&r.includes(kind==='prices'?'Price':'Filing')));
  }
});

test('live price freshness boundary allows forty-five days and old annual filings',async()=>{
  const stock=datedLiveRecord('2026-09-12','2025-06-30');
  const run=await runResearch({...defaultProfile,mode:'live'},{...clock,stocks:[stock]});
  assert.equal(run.eligibleCount,1);
  assert.equal(run.opportunities[0].status,'qualified');
  const beyond=datedLiveRecord('2026-09-11T23:59:59Z','2025-06-30');
  const rejected=await runResearch({...defaultProfile,mode:'live'},{...clock,stocks:[beyond]});
  assert.equal(rejected.eligibleCount,0);
});

test('sample provenance validation continues to replay the fixture clock in later years',async()=>{
  const current=await runResearch(defaultProfile,clock);
  const replay=await runResearch(defaultProfile,{...clock,now:new Date('2030-10-27T00:00:00Z')});
  assert.equal(replay.eligibleCount,current.eligibleCount);
  assert.deepEqual(replay.opportunities,current.opportunities);
});

test('a multi-market mandate exposes missing source coverage instead of implying global coverage',async()=>{
  const stock=datedLiveRecord('2026-10-27');
  const run=await runResearch({...defaultProfile,markets:['US','India'],mode:'live'},{...clock,stocks:[stock]});
  assert.equal(run.universeCount,1);
  assert.ok(run.warnings.some(w=>w.includes('India')&&w.includes('no source records')));
  assert.ok(run.events.some(e=>e.agent==='Data steward'&&e.action==='Disclose missing market coverage'&&e.status==='warning'));
  assert.ok(run.warnings.some(w=>w.includes('Findings apply only to US')));
});

test('foreign listings cannot qualify for a base-currency mandate without aligned FX history',async()=>{
  const stock=sampleUniverse.find(s=>s.symbol==='V')!;
  const foreign=await runResearch({...defaultProfile,markets:['US'],baseCurrency:'INR',maxVolatility:80,maxDrawdown:80},{...clock,stocks:[stock]});
  assert.equal(foreign.opportunities[0].status,'watch');
  assert.ok(foreign.opportunities[0].metrics.every(m=>m.passed));
  assert.equal(foreign.eligibleCount,0);assert.equal(foreign.abstained,true);
  assert.ok(foreign.opportunities[0].reasons.some(r=>r.includes('Base-currency risk is unverified')&&r.includes('INR FX history')));
  const aligned=await runResearch({...defaultProfile,markets:['US'],baseCurrency:'USD',maxVolatility:80,maxDrawdown:80},{...clock,stocks:[stock]});
  assert.equal(aligned.opportunities[0].status,'qualified');
});

test('an HKD listing can qualify for an HKD mandate while remaining watch-only in USD',async()=>{
  const stock={...sampleUniverse.find(s=>s.symbol==='V')!,symbol:'HKTEST',name:'Synthetic HKD fixture',market:'China' as const,exchange:'HKEX',currency:'HKD'};
  const local=await runResearch({...defaultProfile,markets:['China'],baseCurrency:'HKD',maxVolatility:80,maxDrawdown:80},{...clock,stocks:[stock]});
  assert.equal(local.opportunities[0].status,'qualified');assert.equal(local.eligibleCount,1);
  const foreign=await runResearch({...defaultProfile,markets:['China'],baseCurrency:'USD',maxVolatility:80,maxDrawdown:80},{...clock,stocks:[stock]});
  assert.equal(foreign.opportunities[0].status,'watch');assert.equal(foreign.eligibleCount,0);
});
