import {firebaseRequest} from '../firebase/context';
import {getCachedSecFundamentals} from './sec-fundamentals';
import {roundTripFinancialObservation,type ZetarisLayerOptions} from './zetaris-layer';
import {retainQuote,quoteRefreshOrder,type SavedQuote} from './quote-observations';
import {decodeRecord} from '../firebase/codec';
import {reserveCredits,type QuotaState} from './quota';
import {latestMarketScan} from './screening';
import {createHash} from 'node:crypto';
import {MarketDataClient} from './market-data';
import {firebaseAdmin} from '../firebase/admin';
import {getUserRoot,assertAccount,readRecord,writeRecord} from './persistence';
import {resolveDataKey,getPreferences,dataProviderFor,type DataPurpose} from './settings';
import {researchUniverse,selectResearchUniverse,type ResearchInstrument} from '../../lib/finance/universe';
import {instrumentSchema,instrumentKey,type InstrumentRef,type MarketProvider,type ProviderResult,type MarketQuote,type MarketHistory,type CompanyFundamentals} from '../../lib/finance/contracts';
import {analyzeHistory} from '../../lib/finance/math';
import {HttpError} from '../../lib/server/http';
import type {Market} from '../../lib/contracts';

const noData=<T>(provider:MarketProvider,instrument?:InstrumentRef):ProviderResult<T>=>({status:'unavailable',data:null,provenance:{provider,fetchedAt:new Date().toISOString(),asOf:null,sourceUrl:'',currency:instrument?.currency??null,timezone:null,adjustment:'unknown',delay:'unknown'},warnings:['Connect a market-data key and confirm appropriate display and processing rights in Settings to load observed prices, charts and financial data.']});
export async function marketClient(userId:string,provider?:MarketProvider,signal?:AbortSignal){const config=await resolveDataKey(userId,provider);if(!config)return null;
 const digest=createHash('sha256').update(config.apiKey).digest('hex').slice(0,24),defaults=config.provider==='alphavantage'?{minute:5,day:25}:config.provider==='twelvedata'?{minute:8,day:800}:{minute:55,day:2000},limits={minute:config.minuteBudget??defaults.minute,day:config.dayBudget??defaults.day};
 return new MarketDataClient({...config,userId,signal,maxRequestsPerMinute:limits.minute,maxRequestsPerDay:limits.day,reserveQuota:async credits=>{
  const ref=getUserRoot(userId).collection('market_quotas').doc(config.provider+'-'+digest);return firebaseAdmin().db.runTransaction(async tx=>{await assertAccount(tx,userId);const row=await tx.get(ref),reservation=reserveCredits((row.data()??{}) as QuotaState,Date.now(),credits,limits);if(!reservation.allowed)return {allowed:false,retryAfterSeconds:reservation.retryAfterSeconds};tx.set(ref,reservation.state!);return {allowed:true};});
 }});
}
export function instrumentFromQuery(params:URLSearchParams):InstrumentRef{const value=Object.fromEntries(['symbol','market','exchange','currency','providerSymbol','name'].flatMap(k=>params.get(k)?[[k,params.get(k)]]:[]));const parsed=instrumentSchema.safeParse(value);if(!parsed.success)throw new HttpError(400,'Choose a symbol and market before requesting data.','INVALID_INSTRUMENT');const known=researchUniverse.find(i=>i.symbol.toUpperCase()===parsed.data.symbol.toUpperCase()&&i.market===parsed.data.market);return {...known,...parsed.data};}
interface StoredObservation<T>{expiresAt:number;result:ProviderResult<T>}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export interface ObservationDependencies {
 providerFor:typeof dataProviderFor;resolveKey:typeof resolveDataKey;
 client:(userId:string,provider?:MarketProvider)=>Promise<Pick<MarketDataClient,'quote'|'history'|'fundamentals'>|null>;
 read:typeof readRecord;write:typeof writeRecord;deliver:typeof roundTripFinancialObservation;
 cachedSEC:typeof getCachedSecFundamentals;now:()=>number;requestStartedAt:()=>number|undefined;
}
/** All usable native, cached and retained values cross the same owner-scoped data-layer boundary. */
export function createObservationService(overrides:Partial<ObservationDependencies>={}){
 const deps:ObservationDependencies={providerFor:dataProviderFor,resolveKey:resolveDataKey,client:marketClient,read:readRecord,write:writeRecord,deliver:roundTripFinancialObservation,cachedSEC:getCachedSecFundamentals,now:Date.now,requestStartedAt:()=>firebaseRequest()?.startedAt,...overrides};
 const start=()=>deps.requestStartedAt()??deps.now();
 const usable=(value:ProviderResult<unknown>)=>['ok','partial'].includes(value.status)&&value.data!==null;
 async function deliver<T>(userId:string,instrument:InstrumentRef,kind:'quote'|'history'|'fundamentals',value:ProviderResult<T>,startedAt:number):Promise<ProviderResult<T>>{
  if(!usable(value))return value;const options:ZetarisLayerOptions&{startedAt:number}={instrumentKey:instrumentKey(instrument),startedAt};return deps.deliver(userId,kind,value,options);
 }
 async function observed<T>(userId:string,instrument:InstrumentRef,kind:'quote'|'history'|'fundamentals',override?:MarketProvider):Promise<ProviderResult<T>>{
  const startedAt=start(),provider=override??await deps.providerFor(userId,kind),config=await deps.resolveKey(userId,provider);
  if(!config){if(kind==='fundamentals'){const snapshot=deps.cachedSEC(instrument);if(snapshot)return deliver(userId,instrument,kind,snapshot as unknown as ProviderResult<T>,startedAt);}return noData<T>(provider,instrument);}
  const keyHash=digest(config.apiKey),cacheId=digest([provider,keyHash,kind,instrumentKey(instrument),instrument.providerSymbol??''].join(':'));
  const saved=await deps.read<StoredObservation<T>>(userId,'market_cache',cacheId);
  if(saved&&saved.expiresAt>deps.now())return deliver(userId,instrument,kind,{...saved.result,cached:true},startedAt);
  const client=await deps.client(userId,provider);if(!client)return noData<T>(provider,instrument);
  const native=await(kind==='quote'?client.quote(instrument):kind==='history'?client.history(instrument,{limit:400}):client.fundamentals(instrument)) as ProviderResult<T>;
  const result=await deliver(userId,instrument,kind,native,startedAt);
  if(usable(result))await deps.write(userId,'market_cache',cacheId,{expiresAt:deps.now()+(kind==='quote'?60000:21600000),result});
  if(kind==='quote'){
   const quoteId=digest(instrumentKey(instrument)),prior=await deps.read<SavedQuote>(userId,'portfolio_quotes',quoteId);
   const latest=result as unknown as ProviderResult<MarketQuote>;
   const retained=retainQuote(prior,latest,provider,keyHash,new Date(deps.now()).toISOString());
   const verified=retained.result===latest?latest:await deliver(userId,instrument,'quote',retained.result,startedAt);
   // An unavailable required layer cannot turn an older native cache entry into a new successful saved observation.
   if(usable(verified)||!prior?.result.data)await deps.write(userId,'portfolio_quotes',quoteId,{...retained,result:verified});
  }
  return result;
 }
 async function savedQuote(userId:string,instrument:InstrumentRef,value:ProviderResult<MarketQuote>,operationStartedAt=start()){
  return deliver(userId,instrument,'quote',{...value,cached:true,warnings:[...value.warnings,'Saved observation from the last successful request. Check its timestamp before using this valuation.']},operationStartedAt);
 }
 return {observedQuote:(userId:string,instrument:InstrumentRef)=>observed<MarketQuote>(userId,instrument,'quote'),observedHistory:(userId:string,instrument:InstrumentRef)=>observed<MarketHistory>(userId,instrument,'history'),observedFundamentals:(userId:string,instrument:InstrumentRef)=>observed<CompanyFundamentals>(userId,instrument,'fundamentals'),observed,savedQuote};
}
const observations=createObservationService();
export const observedQuote=observations.observedQuote;
export const observedHistory=observations.observedHistory;
export const observedFundamentals=observations.observedFundamentals;
/** Twelve Data currency-pair history is separate observed evidence, never an assumed peg. */
export async function observedFXHistory(userId:string,listingCurrency:string,baseCurrency:string):Promise<ProviderResult<MarketHistory>>{
 if(!/^[A-Z]{3}$/.test(listingCurrency)||!/^[A-Z]{3}$/.test(baseCurrency)||listingCurrency===baseCurrency)throw new HttpError(400,'Choose two different currency codes.','INVALID_FX_PAIR');
 const pair=listingCurrency+'/'+baseCurrency;
 return observations.observed<MarketHistory>(userId,{symbol:pair,providerSymbol:pair,market:'US',currency:baseCurrency,name:listingCurrency+' to '+baseCurrency+' currency history'},'history','twelvedata');
}
export async function newsMarketClient(userId:string){return marketClient(userId,await dataProviderFor(userId,'news'));}
export async function marketListing(userId:string,params:URLSearchParams){const markets=(params.get('markets')??params.get('regions')??'US,India,China,UAE').split(',').filter((v):v is Market=>['US','India','China','UAE'].includes(v)),sectors=(params.get('sectors')??'').split(',').filter(Boolean),query=(params.get('q')??params.get('query')??'').trim().slice(0,100),limit=Math.min(40,Math.max(1,Number(params.get('limit')??24)||24));
 let instruments:ResearchInstrument[]=selectResearchUniverse({markets,sectors,limit:40}).filter(i=>!query||[i.symbol,i.name,i.exchange].join(' ').toLowerCase().includes(query.toLowerCase())).slice(0,limit);
 const client=await marketClient(userId);let providerSearch:unknown=null;
 if(query&&client&&!sectors.length){const found=await client.search(query,markets.length===1?markets[0]:undefined);providerSearch=found;if(found.data)for(const i of found.data){if(!instruments.some(k=>instrumentKey(k)===instrumentKey(i))&&instruments.length<limit)instruments.push({...i,sector:'Unclassified',assetType:'equity',metadataSource:found.provenance.sourceUrl});}}
 const scan=await latestMarketScan(userId);
 return {instruments:instruments.map(i=>({...i,assetClass:i.assetType,quote:null,history:null,analysis:null,factors:scan?.factors.find(f=>instrumentKey(f.instrument)===instrumentKey(i))??null})),factorCohort:scan?{completedAt:scan.completedAt,inputs:scan.inputs,peerCount:scan.factors.length,warnings:scan.warnings}:null,asOf:null,coverage:{available:!!client,scope:'Instrument discovery. Prices and charts load from your selected provider when requested.',markets,sectors,provider:(await getPreferences(userId)).dataProvider},providerSearch};
}
export async function portfolioQuotes(userId:string,instruments:InstrumentRef[],refresh:boolean){
 const operationStartedAt=firebaseRequest()?.startedAt??Date.now();
 if(!instruments.length)return [];
 const provider=await dataProviderFor(userId,'quote'),config=await resolveDataKey(userId,provider);if(!config)return [];
 const keyHash=digest(config.apiKey),unique=[...new Map(instruments.map(i=>[instrumentKey(i),i])).values()],refs=unique.map(i=>getUserRoot(userId).collection('portfolio_quotes').doc(digest(instrumentKey(i))));
 const stored:FirebaseFirestore.DocumentSnapshot[]=[];for(let index=0;index<refs.length;index+=500)stored.push(...await firebaseAdmin().db.getAll(...refs.slice(index,index+500)));
 const rows=unique.map((instrument,index)=>{const raw=stored[index]?.exists?decodeRecord<SavedQuote>(stored[index].get('record')):null;return {instrument,saved:raw?.provider===provider&&raw.keyHash===keyHash?raw:null};}),results:ProviderResult<MarketQuote>[]=[];
 let fetched=0;
 for(const row of quoteRefreshOrder(rows)){
  if(refresh&&fetched<8){const result=await observedQuote(userId,row.instrument);if(!result.cached)fetched++;
   const snapshot=retainQuote(row.saved,result,provider,keyHash,new Date().toISOString());results.push(await observations.savedQuote(userId,row.instrument,snapshot.result,operationStartedAt));
   if(['rate_limited','unauthorized'].includes(result.status))refresh=false;
  }else if(row.saved?.result.data)results.push(await observations.savedQuote(userId,row.instrument,row.saved.result,operationStartedAt));
 }
 return results;
}
export const analyzeObservedHistory=(value:ProviderResult<MarketHistory>)=>value.data?analyzeHistory(value.data):null;
