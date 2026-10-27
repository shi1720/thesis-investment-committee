import test from 'node:test';
import assert from 'node:assert/strict';
import { researchReport } from '../lib/server/report';
import type { ResearchRun } from '../lib/contracts';

test('research report escapes user/source text and keeps sample labeling',()=>{
  const run={id:'r',createdAt:'2026-10-27',title:'<script>alert(1)</script>',summary:'<img onerror="bad">',mode:'sample',profile:{markets:['US'],horizonMonths:36,targetReturn:12,maxVolatility:25,maxDrawdown:25,baseCurrency:'USD'},feasibility:{message:'A & B'},opportunities:[],scenarios:[],events:[],evidence:[{id:'x',title:'Source',publisher:'p',asOf:'x',sample:true,excerpt:'<unsafe>',url:'https://example.com/?x=" onmouseover="bad'}],methodology:[],warnings:[],cost:{modelCalls:0,actualUsd:0}} as unknown as ResearchRun;
  const html=researchReport(run);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Synthetic sample data'));
  assert.ok(html.includes('&quot; onmouseover=&quot;'));
  run.evidence.push({...run.evidence[0],id:'fixture',url:'#sample-fixture'});
  const fixtureReport=researchReport(run);
  assert.ok(fixtureReport.includes('Fixture record: fixture'));
  assert.ok(!fixtureReport.includes('href="#sample-fixture"'));
});
