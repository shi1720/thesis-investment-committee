import type {MarketProvider,MarketQuote,ProviderResult} from '../../lib/finance/contracts';
export interface SavedQuote {provider:MarketProvider;keyHash:string;attemptedAt?:string;lastStatus?:ProviderResult<MarketQuote>['status'];result:ProviderResult<MarketQuote>}
export function retainQuote(previous:SavedQuote|null,latest:ProviderResult<MarketQuote>,provider:MarketProvider,keyHash:string,at:string):SavedQuote{
 const compatible=previous?.provider===provider&&previous.keyHash===keyHash;
 const result=!latest.data&&compatible&&previous.result.data?{...previous.result,status:'partial' as const,cached:true,warnings:[...previous.result.warnings,...latest.warnings,'The most recent request did not return a new price. The saved observation keeps its original timestamp.']}:latest;
 return {provider,keyHash,attemptedAt:at,lastStatus:latest.status,result};
}
/** Missing and oldest attempted instruments go first, so large portfolios do not starve. */
export function quoteRefreshOrder<T extends {saved:SavedQuote|null}>(rows:T[]):T[]{return [...rows].sort((a,b)=>{
 const time=(row:T)=>{const value=Date.parse(row.saved?.attemptedAt??row.saved?.result.provenance.fetchedAt??'');return Number.isFinite(value)?value:0;};return time(a)-time(b);
 });}
