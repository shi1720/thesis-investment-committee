import {IngestionError,sourceJson} from './http';
import type {VerifiedUsSymbol} from './sec';
export interface PersonalPrices {symbol:string;currency:'USD';exchange:string;dates:string[];closes:number[];asOf:string;sourceUrl:string;adjustment:string;usage:'personal-research-only';}
/** Unofficial public endpoint. Explicit private personal-use opt-in is mandatory. */
export async function fetchPersonalYahooPrices(symbol:VerifiedUsSymbol,personalOnly:boolean,now=new Date(),fetcher:typeof fetch=fetch):Promise<PersonalPrices>{
 if(!Object.prototype.hasOwnProperty.call({AAPL:1,MSFT:1},symbol))throw new IngestionError('UNVERIFIED_SYMBOL','Only verified AAPL/MSFT US symbols are supported.');
 if(!personalOnly)throw new IngestionError('PERSONAL_USE_REQUIRED','Yahoo ingestion is restricted to explicit private personal research. It supplies no commercial or redistribution permission.');
 const url=`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2y&events=splits`;
 const raw=await sourceJson(url,{'User-Agent':'ThesisResearch/0.1 personal research','Accept':'application/json'},fetcher,2_000_000);
 return parsePersonalYahooPrices(symbol,raw,now,true);
}
export function parsePersonalYahooPrices(symbol:VerifiedUsSymbol,raw:unknown,now=new Date(),personalOnly=false):PersonalPrices{
 if(!Object.prototype.hasOwnProperty.call({AAPL:1,MSFT:1},symbol))throw new IngestionError('UNVERIFIED_SYMBOL','Only verified AAPL/MSFT US symbols are supported.');
 if(!personalOnly)throw new IngestionError('PERSONAL_USE_REQUIRED','Private personal-research acknowledgement is required even for cached vendor data.');
 const chart=(raw as {chart?:{error?:unknown;result?:unknown[]}})?.chart;
 if(!chart||chart.error||!Array.isArray(chart.result)||chart.result.length!==1)throw new IngestionError('YAHOO_SCHEMA','Yahoo returned no unambiguous chart; no alternate authenticated endpoint was attempted.');
 const r=chart.result[0] as {meta?:{symbol?:string;currency?:string;exchangeName?:string;dataGranularity?:string};timestamp?:number[];events?:{splits?:Record<string,unknown>};indicators?:{quote?:{close?:unknown[]}[];adjclose?:unknown}};
 if(r.meta?.symbol!==symbol||r.meta?.currency!=='USD'||r.meta?.dataGranularity!=='1d')throw new IngestionError('YAHOO_IDENTITY','The quote is not the requested USD daily US security.');
 if(r.events?.splits&&Object.keys(r.events.splits).length)throw new IngestionError('SPLIT_REVIEW_REQUIRED','A stock split occurred in this history. This conservative adapter does not infer split adjustments; use an entitled, documented split-adjusted feed.');
 const dates=r.timestamp,closes=r.indicators?.quote?.[0]?.close;
 if(!Array.isArray(dates)||!Array.isArray(closes)||dates.length!==closes.length||dates.length<61||dates.length>1000)throw new IngestionError('YAHOO_SERIES','Daily price rows are missing, unaligned or outside the bounded observation count.');
 let previous=-Infinity;
 for(let i=0;i<dates.length;i++){
  if(!Number.isSafeInteger(dates[i])||dates[i]<=previous||dates[i]*1000>now.getTime()||typeof closes[i]!=='number'||!Number.isFinite(closes[i])||(closes[i] as number)<=0)throw new IngestionError('YAHOO_SERIES','Price history has missing, invalid, future or unordered observations; none were silently dropped.');
  previous=dates[i];
 }
 const observed=dates.map(t=>new Date(t*1000).toISOString().slice(0,10));
 if(new Set(observed).size!==observed.length)throw new IngestionError('YAHOO_SERIES','Multiple rows resolve to one daily session.');
 const asOf=observed[observed.length-1];
 if(now.getTime()-Date.parse(asOf)>45*86_400_000)throw new IngestionError('STALE_PRICES','The latest observed market session is more than45days old. Fetch time does not refresh stale prices.');
 return {symbol,currency:'USD',exchange:r.meta.exchangeName??'',dates:observed,closes:closes as number[],asOf,sourceUrl:`https://finance.yahoo.com/quote/${symbol}/history/`,adjustment:'quote.close only; no dividend adjustment. The explicitly requested split-event window contains no reported split, so no split adjustment is inferred. adjclose is deliberately unused.',usage:'personal-research-only'};
}
