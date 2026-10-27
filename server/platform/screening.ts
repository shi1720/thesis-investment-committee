import {z} from 'zod';
import {markets} from '../../lib/contracts';
import {selectResearchUniverse} from '../../lib/finance/universe';
import {scoreFactors} from '../../lib/finance/features';
import {analyzeHistory} from '../../lib/finance/math';
import {instrumentKey,type FactorInput,type DataProvenance} from '../../lib/finance/contracts';
import {observedHistory,observedFundamentals} from './market-service';
import {readRecord,writeRecord} from './persistence';
import {dataProviderFor,resolveDataKey} from './settings';
import {HttpError} from '../../lib/server/http';
export const scanSchema=z.object({markets:z.array(z.enum(markets)).min(1).max(4),sectors:z.array(z.string().trim().min(1).max(80)).max(12).default([]),limit:z.number().int().min(5).max(6).default(6)}).strict();
export interface MarketScan {startedAt:string;completedAt:string;inputs:z.infer<typeof scanSchema>;factors:ReturnType<typeof scoreFactors>;history:{instrument:FactorInput['instrument'];analysis:FactorInput['history']}[];sources:{instrument:FactorInput['instrument'];history:DataProvenance|null;fundamentals:DataProvenance|null}[];warnings:string[]}
export const latestMarketScan=(userId:string)=>readRecord<MarketScan>(userId,'market_scans','latest');
/** An explicit bounded cohort scan. No model call, automatic refresh or provider fallback. */
export async function scanMarkets(userId:string,raw:unknown):Promise<MarketScan>{
 const parsed=scanSchema.safeParse(raw);if(!parsed.success)throw new HttpError(400,'Choose at least one market and a supported scan size.','INVALID_SCAN');
 const feeds=await Promise.all(['history','fundamentals'].map(async purpose=>resolveDataKey(userId,await dataProviderFor(userId,purpose as 'history'|'fundamentals'))));if(feeds.every(feed=>!feed))throw new HttpError(409,'Connect an appropriately entitled history or fundamentals data source before scanning.','DATA_SETUP_REQUIRED');
 const inputs=parsed.data,startedAt=new Date().toISOString(),instruments=selectResearchUniverse({markets:inputs.markets,sectors:inputs.sectors,limit:40}).filter(i=>i.assetType==='equity').slice(0,inputs.limit),cohort:FactorInput[]=[],sources:MarketScan['sources']=[],warnings=new Set<string>();
 for(let index=0;index<instruments.length;index+=2){
  await Promise.all(instruments.slice(index,index+2).map(async instrument=>{
   const [history,fundamentals]=await Promise.all([observedHistory(userId,instrument),observedFundamentals(userId,instrument)]);
   cohort.push({instrument,history:history.data?analyzeHistory(history.data):null,fundamentals:fundamentals.data});
   sources.push({instrument,history:history.data?history.provenance:null,fundamentals:fundamentals.data?fundamentals.provenance:null});
   for(const warning of [...history.warnings,...fundamentals.warnings])warnings.add(warning);
  }));
 }
 const order=new Map(instruments.map((i,index)=>[instrumentKey(i),index]));cohort.sort((a,b)=>order.get(instrumentKey(a.instrument))!-order.get(instrumentKey(b.instrument))!);sources.sort((a,b)=>order.get(instrumentKey(a.instrument))!-order.get(instrumentKey(b.instrument))!);
 const scan:MarketScan={startedAt,completedAt:new Date().toISOString(),inputs,factors:scoreFactors(cohort,{minPeers:5}),history:cohort.map(i=>({instrument:i.instrument,analysis:i.history})),sources,warnings:[...warnings,'Each descriptor requires at least five valid observed peers. The composite requires all four factors. Missing factors remain unavailable.','Ranks describe only this research cohort. Sector, currency, accounting and country differences affect comparisons. A percentile is not an expected return or probability.','A scan requests history and fundamentals for each selected company, subject to the configured provider credit budgets. No price series or metric is invented.']};
 await writeRecord(userId,'market_scans','latest',scan);return scan;
}
