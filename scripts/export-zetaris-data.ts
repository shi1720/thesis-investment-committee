/** Export deterministic synthetic fixtures into three genuinely separate source feeds. */
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sampleUniverse,SAMPLE_AS_OF,SAMPLE_NOTICE} from '../lib/research/sample-data';
import type {Stock} from '../lib/contracts';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function splitStockSources(stocks:Stock[]) {
  const prices=stocks.map(s=>({symbol:s.symbol,market:s.market,exchange:s.exchange,currency:s.currency,as_of:s.asOf,price:s.price,annual_return:s.annualReturn,annual_volatility:s.annualVolatility,max_drawdown:s.maxDrawdown,prices_json:JSON.stringify(s.prices),sample:true}));
  const fundamentals=stocks.map(s=>({symbol:s.symbol,market:s.market,as_of:s.asOf,name:s.name,sector:s.sector,revenue_growth:s.revenueGrowth,operating_margin:s.operatingMargin,debt_to_equity:s.debtToEquity,pe:s.pe,dividend_yield:s.dividendYield,market_cap_bn:s.marketCapBn,quality:s.quality,catalyst:s.catalyst,risk:s.risk,thesis:s.thesis,sample:true}));
  const filings=stocks.map(s=>({symbol:s.symbol,market:s.market,as_of:s.asOf,evidence_json:JSON.stringify(s.evidence),sample:true}));
  return {prices,fundamentals,filings};
}
const csvValue=(v:unknown)=>`"${String(v).replace(/"/g,'""')}"`;
export function csv(rows:Record<string,unknown>[]):string {
  if(!rows.length)throw new Error('Cannot export an empty fundamentals feed.');
  const keys=Object.keys(rows[0]);
  return keys.map(csvValue).join(',')+'\n'+rows.map(row=>keys.map(k=>csvValue(row[k])).join(',')).join('\n')+'\n';
}
const jsonl=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
export async function exportZetarisData(out=join(root,'data/zetaris')){
  const sources=splitStockSources(sampleUniverse);
  const files:Record<string,string>={'prices.json':JSON.stringify(sources.prices,null,2)+'\n','prices.jsonl':jsonl(sources.prices),'fundamentals.csv':csv(sources.fundamentals),'filings.json':JSON.stringify(sources.filings,null,2)+'\n','filings.jsonl':jsonl(sources.filings),'sample-universe.json':JSON.stringify(sampleUniverse,null,2)+'\n'};
  const fixtureManifest={schemaVersion:1,synthetic:true,asOf:SAMPLE_AS_OF,notice:SAMPLE_NOTICE,markets:['US','India','China','UAE'],securities:sampleUniverse.length,sourceRows:{prices:sources.prices.length,fundamentals:sources.fundamentals.length,filings:sources.filings.length},expectedViewRows:sampleUniverse.length,pricesPerSecurity:505,sourceSha256:Object.fromEntries(Object.entries(files).map(([name,body])=>[name,createHash('sha256').update(body).digest('hex')])),liveExecutionVerified:false};
  files['fixture-manifest.json']=JSON.stringify(fixtureManifest,null,2)+'\n';
  await mkdir(out,{recursive:true});
  for(const [name,body] of Object.entries(files))await writeFile(join(out,name),body,'utf8');
  return {output:out,securities:sampleUniverse.length,files:Object.keys(files),synthetic:true,liveExecutionVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  exportZetarisData().then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Fixture export failed. No live integration was verified.');process.exitCode=1});
}
