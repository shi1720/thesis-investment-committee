import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProfile, type ResearchProfile} from '../lib/contracts';
import {runResearch, assessFeasibility} from '../lib/research/engine';
import {sampleUniverse} from '../lib/research/sample-data';
import {priceMetrics} from '../lib/research/math';
const fixed = {now:new Date('2026-10-27T00:00:00.000Z'),id:'test-run'};
const profile = (overrides:Partial<ResearchProfile>={}) => ({...defaultProfile,...overrides});

test('quant math matches a known geometric path and peak/trough loss',()=>{
  const prices=Array.from({length:253},(_,i)=>100*Math.pow(1.10,i/252));
  const q=priceMetrics(prices);
  assert.ok(Math.abs(q.annualReturn-10)<1e-9);
  assert.ok(q.annualVolatility<1e-10);
  assert.equal(q.maxDrawdown,0);
  const falling=[...Array(61).fill(100),50,75];
  assert.equal(priceMetrics(falling).maxDrawdown,50);
  assert.throws(()=>priceMetrics([100,90]),/61/);
  assert.throws(()=>priceMetrics([...prices.slice(0,61),NaN]),/finite/);
});

test('sample data covers all four markets and is explicitly synthetic',()=>{
  assert.equal(sampleUniverse.length,20);
  assert.deepEqual(new Set(sampleUniverse.map(s=>s.market)),new Set(['US','India','China','UAE']));
  for(const s of sampleUniverse){
    assert.equal(s.prices.length,505);
    assert.ok(s.evidence.every(e=>e.sample));
    assert.ok(s.evidence.some(e=>e.excerpt.includes('Synthetic')));
    assert.ok(Math.abs(s.prices.at(-1)!-s.price)<0.00001);
  }
});

test('hard risk gates reject high volatility regardless of growth or quality',async()=>{
  const run=await runResearch(profile(),fixed);
  assert.ok(run.eligibleCount>0);
  const nvda=run.opportunities.find(s=>s.symbol==='NVDA')!;
  assert.equal(nvda.status,'excluded');
  assert.ok(nvda.annualVolatility>defaultProfile.maxVolatility);
  for(const s of run.opportunities.filter(s=>s.status==='qualified')){
    const actual=priceMetrics(s.prices);
    assert.ok(actual.annualVolatility<=run.profile.maxVolatility);
    assert.ok(actual.maxDrawdown<=run.profile.maxDrawdown);
    assert.ok(s.metrics.every(m=>m.passed));
  }
  assert.equal(run.cost.modelCalls,0);
  assert.ok(run.events.every(e=>e.model==='deterministic/research-rules-v1'));
});

test('impossible low risk/high aspiration explicitly abstains',async()=>{
  const p=profile({targetReturn:40,maxVolatility:10,maxDrawdown:10});
  const run=await runResearch(p,fixed);
  assert.equal(assessFeasibility(p).status,'conflict');
  assert.equal(run.abstained,true);
  assert.equal(run.eligibleCount,0);
  assert.ok(run.events.some(e=>e.action==='Branch to abstention'));
  assert.ok(run.opportunities.every(s=>s.status!=='qualified'));
});

test('market and sector filters have actual effects',async()=>{
  const run=await runResearch(profile({markets:['UAE'],excludedSectors:['Financials']}),fixed);
  assert.equal(run.universeCount,5);
  assert.ok(run.opportunities.every(s=>s.market==='UAE'));
  assert.ok(run.opportunities.filter(s=>s.sector==='Financials').every(s=>s.status==='excluded'));
  assert.ok(run.warnings.some(w=>w.includes('not normalized to USD')));
});

test('short horizon routes survivors to watch-only',async()=>{
  const run=await runResearch(profile({horizonMonths:6,maxVolatility:60,maxDrawdown:60}),fixed);
  assert.equal(run.abstained,true);
  assert.equal(run.eligibleCount,0);
  assert.ok(run.opportunities.some(s=>s.status==='watch'));
});

test('critique triggers planner revision and a second risk pass',async()=>{
  const run=await runResearch(profile(),fixed);
  const critique=run.events.findIndex(e=>e.agent==='Skeptic'&&e.iteration===1);
  const replan=run.events.findIndex(e=>e.agent==='Planner'&&e.iteration===2);
  const risk=run.events.findIndex(e=>e.agent==='Risk guardian'&&e.iteration===2);
  assert.ok(critique>=0 && replan>critique && risk>replan);
  assert.ok(run.events.at(-1)?.agent==='Evaluator');
});

test('memory reuses prior critique but recomputes stricter risk gates',async()=>{
  const prior=await runResearch(profile(),fixed);
  const next=await runResearch(profile({maxVolatility:15}),{...fixed,previousRuns:[prior]});
  assert.equal(next.memory.reused,true);
  assert.ok(next.events.some(e=>e.agent==='Memory'));
  assert.ok(next.memory.lessons.some(l=>l.includes('Risk limits changed')));
  assert.ok(next.opportunities.filter(s=>s.status==='qualified').every(s=>priceMetrics(s.prices).annualVolatility<=15));
});

test('exported trace only cites evidence actually present in the dossier',async()=>{
  const run=await runResearch(profile(),fixed);
  const ids=new Set(run.evidence.map(e=>e.id));
  assert.equal(ids.size,run.evidence.length);
  for(const event of run.events) assert.ok(event.evidenceIds.every(id=>ids.has(id)));
  for(const s of run.opportunities) assert.ok(s.evidence.every(e=>ids.has(e.id)));
});

test('ranking and all calculated decisions are reproducible',async()=>{
  const a=await runResearch(profile(),fixed), b=await runResearch(profile(),fixed);
  assert.deepEqual(a.opportunities,b.opportunities);
  assert.deepEqual(a.events,b.events);
  assert.deepEqual(a.scenarios,b.scenarios);
});

test('source summary metrics cannot override prices or missing provenance',async()=>{
  const corrupted={...sampleUniverse[3],annualVolatility:1,maxDrawdown:1};
  const run=await runResearch(profile(),{...fixed,stocks:[corrupted]});
  assert.equal(run.opportunities[0].status,'excluded');
  assert.ok(run.opportunities[0].annualVolatility>40);
  const missing={...sampleUniverse[0],evidence:[]};
  const bad=await runResearch(profile(),{...fixed,stocks:[missing]});
  assert.equal(bad.opportunities[0].status,'excluded');
  assert.ok(bad.opportunities[0].reasons.some(r=>r.includes('provenance')));
});

test('stale evidence and invalid price paths fail closed',async()=>{
  const stale={...sampleUniverse[0],asOf:'2025-01-01'};
  const invalid={...sampleUniverse[1],prices:[...sampleUniverse[1].prices.slice(0,70),-3]};
  const run=await runResearch(profile(),{...fixed,stocks:[stale,invalid]});
  assert.equal(run.abstained,true);
  assert.ok(run.opportunities.every(s=>s.status==='excluded'));
});

test('live mode never silently uses synthetic fixtures',async()=>{
  const empty=await runResearch(profile({mode:'live'}),fixed);
  assert.equal(empty.mode,'degraded');
  assert.equal(empty.universeCount,0);
  assert.equal(empty.abstained,true);
  const contaminated=await runResearch(profile({mode:'live'}),{...fixed,stocks:[sampleUniverse[0]]});
  assert.equal(contaminated.abstained,true);
  assert.equal(contaminated.opportunities[0].status,'excluded');
  assert.ok(contaminated.opportunities[0].reasons.some(r=>r.includes('Sample evidence')));
});

test('adversarial profile values are rejected before analysis',async()=>{
  await assert.rejects(()=>runResearch(profile({markets:[]}),fixed));
  await assert.rejects(()=>runResearch(profile({targetReturn:NaN}),fixed));
  await assert.rejects(()=>runResearch(profile({capital:-1}),fixed));
  await assert.rejects(()=>runResearch(profile({horizonMonths:0}),fixed));
  await assert.rejects(()=>runResearch(profile({maxVolatility:Infinity}),fixed));
});

test('three physical source projections reconstruct the complete Stock contract',async()=>{
  const {splitStockSources}=await import('../scripts/export-zetaris-data');
  const feeds=splitStockSources(sampleUniverse);
  assert.equal(feeds.prices.length,20);
  assert.equal(feeds.fundamentals.length,20);
  assert.equal(feeds.filings.length,20);
  for(const stock of sampleUniverse){
    const key=(s:{symbol:string;market:string;as_of:string})=>s.symbol===stock.symbol&&s.market===stock.market&&s.as_of===stock.asOf;
    const p=feeds.prices.find(key)!,f=feeds.fundamentals.find(key)!,e=feeds.filings.find(key)!;
    assert.ok(p&&f&&e);
    assert.deepEqual(JSON.parse(p.prices_json),stock.prices);
    assert.deepEqual(JSON.parse(e.evidence_json),stock.evidence);
    assert.equal(f.revenue_growth,stock.revenueGrowth);
    assert.equal(f.quality,stock.quality);
    assert.equal(f.thesis,stock.thesis);
    assert.ok(JSON.parse(e.evidence_json).every((source:{sample:boolean})=>source.sample));
  }
});

test('skeptic revision actually changes the winning rank before risk approval',async()=>{
  const base=sampleUniverse[0];
  const challenged={...base,symbol:'CHALLENGED',name:'Higher valuation fixture',quality:100,revenueGrowth:60,operatingMargin:50,pe:46};
  const steady={...base,symbol:'STEADY',name:'Steady fixture',quality:90,revenueGrowth:10,operatingMargin:30,pe:25};
  const run=await runResearch(profile({markets:['US'],maxVolatility:80,maxDrawdown:80}),{...fixed,stocks:[challenged,steady]});
  assert.equal(run.opportunities[0].symbol,'STEADY');
  assert.equal(run.opportunities[0].status,'qualified');
  const initial=run.events.find(e=>e.action==='Build the initial uncritiqued ranking')!;
  assert.ok(initial.detail.startsWith('Initial leaders: CHALLENGED'));
  const final=run.events.find(e=>e.action==='Veto candidates that breach the mandate')!;
  assert.ok(final.detail.includes('Final qualified leaders: STEADY'));
  assert.ok(run.events.find(e=>e.agent==='Planner'&&e.iteration===2)?.detail.includes('CHALLENGED:'));
  const revised=run.opportunities.find(s=>s.symbol==='CHALLENGED')!;
  assert.ok(revised.analystNote?.includes('revised to'));
});

test('sample replay remains reproducible after the fixture date while live snapshots expire',async()=>{
  const a=await runResearch(profile(),fixed);
  const b=await runResearch(profile(),{...fixed,now:new Date('2028-10-27T00:00:00Z')});
  assert.deepEqual(a.opportunities,b.opportunities);
  assert.ok(b.warnings.some(w=>w.includes('fixed 2026-10-23 fixture clock')));
  const liveRecord={...sampleUniverse[0],evidence:sampleUniverse[0].evidence.map(e=>({...e,sample:false,url:'https://example.com/contract-test-source'}))};
  const stale=await runResearch(profile({mode:'live',maxVolatility:80,maxDrawdown:80}),{...fixed,now:new Date('2028-10-27T00:00:00Z'),stocks:[liveRecord]});
  assert.equal(stale.abstained,true);
  assert.ok(stale.opportunities[0].reasons.some(r=>r.includes('45 days')));
  assert.ok(stale.opportunities[0].reasons.some(r=>r.includes('Supplied historical')));
  assert.ok(stale.opportunities[0].reasons.every(r=>!r.includes('synthetic historical')));
});

test('overflowing finite price inputs fail closed rather than becoming infinite scores',()=>{
  assert.throws(()=>priceMetrics([...Array(61).fill(Number.MIN_VALUE),Number.MAX_VALUE]),/overflowed|finite/);
});
