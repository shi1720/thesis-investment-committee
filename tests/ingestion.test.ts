/** All financial/price values below are synthetic test fixtures, not vendor data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSecFinancials,fetchSecSources,secUrls} from '../lib/ingestion/sec';
import {parsePersonalYahooPrices,fetchPersonalYahooPrices} from '../lib/ingestion/yahoo-personal';
import {buildPersonalStock,derivedQuality} from '../lib/ingestion/build-stock';
import {sourceJson,IngestionError} from '../lib/ingestion/http';
import {privateOutputPath,importMarketData} from '../scripts/import-market-data';
const now=new Date('2026-10-27T00:00:00Z');
const annualAcc='0000000001-25-000001',balanceAcc='0000000001-26-000002';
function fixture(){
 const annual=(value:number,start='2024-10-01',end='2025-09-30')=>({start,end,val:value,accn:annualAcc,form:'10-K',filed:'2025-10-31'});
 const instant=(value:number)=>({end:'2026-06-30',val:value,accn:balanceAcc,form:'10-Q',filed:'2026-07-31'});
 const concept=(unit:string,values:unknown[])=>({label:'Synthetic test fact',description:'Invented test input',units:{[unit]:values}});
 const facts={cik:320193,entityName:'Synthetic Apple Test Fixture',facts:{'us-gaap':{
  RevenueFromContractWithCustomerExcludingAssessedTax:concept('USD',[annual(200),annual(100,'2023-10-01','2024-09-30')]),OperatingIncomeLoss:concept('USD',[annual(40)]),EarningsPerShareDiluted:concept('USD/shares',[annual(2)]),CommonStockDividendsPerShareDeclared:concept('USD/shares',[annual(0.5)]),StockholdersEquity:concept('USD',[instant(100)]),LongTermDebtCurrent:concept('USD',[instant(10)]),LongTermDebtNoncurrent:concept('USD',[instant(20)]),CommercialPaper:concept('USD',[instant(5)]),CommonStockSharesOutstanding:concept('shares',[instant(1_000_000_000)]),
 }}};
 const submissions={cik:'0000320193',name:'Synthetic Apple Test Fixture',sic:'3571',tickers:['AAPL'],exchanges:['Nasdaq'],filings:{recent:{accessionNumber:[annualAcc,balanceAcc],primaryDocument:['synthetic-annual.htm','synthetic-quarterly.htm']}}};
 const dates:number[]=[];for(let d=new Date('2026-10-26T13:30:00Z');dates.length<100;d=new Date(d.getTime()-86_400_000)){if(d.getUTCDay()!==0&&d.getUTCDay()!==6)dates.unshift(d.getTime()/1000);}
 const close=dates.map((_,i)=>100+i*0.05);
 const chart={chart:{error:null,result:[{meta:{symbol:'AAPL',currency:'USD',dataGranularity:'1d',exchangeName:'NMS'},timestamp:dates,events:{splits:{}},indicators:{quote:[{close}],adjclose:[{adjclose:close.map(c=>c*0.8)}]}}]}};
 return {facts,submissions,chart};
}

test('SEC importer derives comparable annual facts and same-filing debt without unknown zero defaults',()=>{
 const f=fixture(),s=extractSecFinancials('AAPL',f.facts,f.submissions,now);
 assert.equal(s.annual.revenue.value,200);assert.equal(s.annual.priorRevenue.value,100);
 assert.equal(s.balance.debtCurrent.value+s.balance.debtNoncurrent.value+s.balance.shortTermDebt.value,35);
 assert.equal(s.balance.equity.end,'2026-06-30');
 assert.ok(Object.values(s.filingUrls).every(url=>url.startsWith('https://www.sec.gov/Archives/edgar/data/320193/')));
 delete (f.facts.facts['us-gaap'] as Record<string,unknown>).CommercialPaper;
 assert.throws(()=>extractSecFinancials('AAPL',f.facts,f.submissions,now),/short-term borrowing component/);
});

test('SEC extraction rejects identity mismatch and ignores unavailable future annual facts',()=>{
 const f=fixture();assert.throws(()=>extractSecFinancials('AAPL',f.facts,{...f.submissions,sic:'9999'},now),/SIC/);
 f.facts.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.unshift({start:'2026-10-01',end:'2027-09-30',val:999,accn:'0000000001-27-000001',form:'10-K',filed:'2027-10-31'});
 assert.equal(extractSecFinancials('AAPL',f.facts,f.submissions,now).annual.revenue.value,200);
});

test('personal price ingestion deliberately uses close rather than dividend-adjusted adjclose',()=>{
 const f=fixture(),p=parsePersonalYahooPrices('AAPL',f.chart,now,true);
 assert.deepEqual(p.closes,f.chart.chart.result[0].indicators.quote[0].close);
 assert.notDeepEqual(p.closes,f.chart.chart.result[0].indicators.adjclose[0].adjclose);
 assert.equal(p.asOf,'2026-10-26');assert.equal(p.usage,'personal-research-only');
 assert.throws(()=>parsePersonalYahooPrices('AAPL',f.chart,now,false),/acknowledgement/);
});

test('unsupported splits, missing closes and stale market sessions fail without silent repair',()=>{
 const split=fixture();split.chart.chart.result[0].events.splits={'split':{numerator:2,denominator:1}};
 assert.throws(()=>parsePersonalYahooPrices('AAPL',split.chart,now,true),/stock split/);
 const missing=fixture();(missing.chart.chart.result[0].indicators.quote[0].close as unknown[])[1]=null;
 assert.throws(()=>parsePersonalYahooPrices('AAPL',missing.chart,now,true),/missing/);
 const stale=fixture();assert.throws(()=>parsePersonalYahooPrices('AAPL',stale.chart,new Date('2027-01-01'),true),/45days/);
});

test('complete Stock contains actual-source flags and explicit derived quality/valuation lineage',()=>{
 const f=fixture(),s=extractSecFinancials('AAPL',f.facts,f.submissions,now),p=parsePersonalYahooPrices('AAPL',f.chart,now,true);
 const built=buildPersonalStock('AAPL',s,p,'2026-10-27T00:00:00Z');
 assert.equal(built.stock.revenueGrowth,100);assert.equal(built.stock.operatingMargin,20);assert.equal(built.stock.debtToEquity,0.35);
 assert.equal(built.stock.quality,derivedQuality(100,20,0.35));assert.ok(built.stock.evidence.every(e=>!e.sample));
 assert.equal(built.stock.evidence.find(e=>e.kind==='prices')?.asOf,'2026-10-26');assert.ok(built.stock.evidence.some(e=>e.kind==='filing'&&e.asOf==='2025-10-31'));
 assert.equal(built.lineage.commercialRightsVerified,false);assert.equal(built.lineage.redistributionAllowed,false);
 assert.ok(String(built.lineage.marketCapDefinition).includes('dated proxy'));
});

test('public data writes and commercial/public ingestion are refused before network access',async()=>{
 assert.throws(()=>privateOutputPath('data/private-vendor-prices'),/public source|repository/);
 assert.ok(privateOutputPath('work/private-test-data').includes('work/private-test-data'));
 await assert.rejects(()=>importMarketData(['--commercial']),/licensed provider/);
 await assert.rejects(()=>importMarketData(['--personal-research','--public']),/redistribution/);
 await assert.rejects(()=>importMarketData(['--personal-research','--symbols','China','--output','work/private-test-data']),/Only verified/);
 await assert.rejects(()=>importMarketData(['--personal-research','--symbols','toString','--output','work/private-test-data']),/Only verified/);
});

test('read-only source access uses declared SEC agent, fixed hosts and no refusal retry',async()=>{
 assert.throws(()=>secUrls('../../bad'),/ten digits/);
 await assert.rejects(()=>fetchSecSources('0000320193','undeclared'),/SEC_USER_AGENT/);
 let calls=0;
 await assert.rejects(()=>sourceJson('https://data.sec.gov/contract-test',{},async()=>{calls++;return new Response('{}',{status:429});}),(e:unknown)=>e instanceof IngestionError&&e.code==='SOURCE_HTTP_429');
 assert.equal(calls,1);
 await assert.rejects(()=>fetchPersonalYahooPrices('AAPL',false,now),/private personal/);
});
