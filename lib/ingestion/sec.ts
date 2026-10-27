import {IngestionError,sourceJson} from './http';
const DAY=86_400_000;
export interface SecFact {tag:string;label:string;description:string;unit:string;value:number;start?:string;end:string;filed:string;accession:string;form:string;}
export interface SecFinancials {
  cik:string;name:string;annualEnd:string;balanceEnd:string;annualFiled:string;
  annual:{revenue:SecFact;priorRevenue:SecFact;operatingIncome:SecFact;eps:SecFact;dividends:SecFact};
  balance:{equity:SecFact;debtCurrent:SecFact;debtNoncurrent:SecFact;shortTermDebt:SecFact;shares:SecFact};
  debtDefinition:string;sector:string;exchange:string;filingUrls:Record<string,string>;warnings:string[];
}
interface FactRow {start?:string;end:string;val:number;accn:string;form:string;filed:string;}
interface Concept {label?:string;description?:string;units?:Record<string,FactRow[]>;}
interface CompanyFacts {cik:number;entityName:string;facts:Record<string,Record<string,Concept>>;}
interface Submissions {cik:string;name:string;sic:string;tickers:string[];exchanges:string[];filings:{recent:Record<string,(string|number)[]>};}
export const verifiedUsIdentities={AAPL:{cik:'0000320193',sic:'3571',sector:'Technology'},MSFT:{cik:'0000789019',sic:'7372',sector:'Technology'}} as const;
export type VerifiedUsSymbol=keyof typeof verifiedUsIdentities;
export function secUrls(cik:string){if(!/^\d{10}$/.test(cik))throw new IngestionError('INVALID_CIK','SEC CIK must have ten digits.');return {facts:`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,submissions:`https://data.sec.gov/submissions/CIK${cik}.json`};}
export async function fetchSecSources(cik:string,userAgent:string,fetcher:typeof fetch=fetch){
  if(userAgent.length>300||/[\r\n]/.test(userAgent)||!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(userAgent))throw new IngestionError('SEC_USER_AGENT_REQUIRED','Set SEC_USER_AGENT to your application/contact name and real contact email, per SEC fair-access guidance.');
  const urls=secUrls(cik),headers={'User-Agent':userAgent,Accept:'application/json'};
  // Sequential requests stay well below the SEC’s ten requests/second ceiling.
  const facts=await sourceJson(urls.facts,headers,fetcher);const submissions=await sourceJson(urls.submissions,headers,fetcher);
  return {facts,submissions};
}
function obj(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new IngestionError('SEC_SCHEMA','SEC source is not an object.');return value as Record<string,unknown>;}
function factsFrom(raw:unknown):CompanyFacts{const p=obj(raw);if(!Number.isSafeInteger(p.cik)||typeof p.entityName!=='string'||!p.facts)throw new IngestionError('SEC_SCHEMA','Missing SEC company identity/facts.');return p as unknown as CompanyFacts;}
function rows(data:CompanyFacts,tags:string[],unit:string,now:Date,annual:boolean):SecFact[]{
 const selected:SecFact[]=[];
 for(const tag of tags){const concept=data.facts['us-gaap']?.[tag]??data.facts['dei']?.[tag];if(!concept)continue;
  for(const r of concept.units?.[unit]??[]){
   const end=Date.parse(r.end),filed=Date.parse(r.filed),days=r.start?(end-Date.parse(r.start))/DAY:null;
   if(!['10-K','10-K/A',...(!annual?['10-Q','10-Q/A']:[])].includes(r.form)||!Number.isFinite(r.val)||!Number.isFinite(end)||!Number.isFinite(filed)||end>now.getTime()||filed>now.getTime()||!/^\d{10}-\d{2}-\d{6}$/.test(r.accn))continue;
   if(annual&&(days===null||days<335||days>395))continue;if(!annual&&r.start)continue;
   selected.push({tag,label:concept.label??tag,description:concept.description??'',unit,value:r.val,start:r.start,end:r.end,filed:r.filed,accession:r.accn,form:r.form});
  }
 }
 return selected.sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed)||a.tag.localeCompare(b.tag));
}
function required(found:SecFact|undefined,field:string):SecFact{if(!found)throw new IngestionError('MISSING_SEC_FIELD',`Missing comparable, dated SEC fact for ${field}. No zero/default was substituted; this security needs a verified filing mapping.`);return found;}
export function extractSecFinancials(symbol:VerifiedUsSymbol,rawFacts:unknown,rawSubmissions:unknown,now=new Date()):SecFinancials{
 const identity=verifiedUsIdentities[symbol];if(!identity)throw new IngestionError('UNVERIFIED_SYMBOL','Only AAPL/MSFT US identities have a verified ingestion mapping; other markets are not claimed.');
 const data=factsFrom(rawFacts),sub=obj(rawSubmissions) as unknown as Submissions;
 if(String(data.cik).padStart(10,'0')!==identity.cik||sub.cik?.padStart(10,'0')!==identity.cik||!Array.isArray(sub.tickers)||!sub.tickers.includes(symbol)||sub.sic!==identity.sic)throw new IngestionError('SEC_IDENTITY_MISMATCH','SEC CIK, ticker or SIC does not match the verified security mapping.');
 const revenue=required(rows(data,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'],'USD',now,true)[0],'annual revenue');
 if(now.getTime()-Date.parse(revenue.end)>550*DAY)throw new IngestionError('STALE_ANNUAL_FACTS','Latest annual revenue period is more than550days old. Do not silently use a defunct taxonomy or stale annual report.');
 const sameAnnual=(tags:string[],unit='USD')=>rows(data,tags,unit,now,true).find(f=>f.end===revenue.end&&f.start===revenue.start&&f.accession===revenue.accession);
 const priorRevenue=required(rows(data,[revenue.tag],'USD',now,true).find(f=>{const days=(Date.parse(revenue.end)-Date.parse(f.end))/DAY;return days>=335&&days<=395&&f.accession===revenue.accession;}),'comparable prior annual revenue from the same filing');
 const operatingIncome=required(sameAnnual(['OperatingIncomeLoss']),'annual operating income'),eps=required(sameAnnual(['EarningsPerShareDiluted'],'USD/shares'),'annual diluted EPS'),dividends=required(sameAnnual(['CommonStockDividendsPerShareDeclared'],'USD/shares'),'annual declared dividends per share');
 const equity=required(rows(data,['StockholdersEquity'],'USD',now,false)[0],'latest common stockholders equity');
 if(equity.end<revenue.end)throw new IngestionError('STALE_BALANCE_FACTS','The latest usable equity fact predates the selected annual report. A stale taxonomy was not substituted.');
 const sameBalance=(tags:string[],unit='USD')=>rows(data,tags,unit,now,false).find(f=>f.end===equity.end&&f.accession===equity.accession);
 const debtCurrent=required(sameBalance(['LongTermDebtCurrent']),'current portion of long-term debt'),debtNoncurrent=required(sameBalance(['LongTermDebtNoncurrent']),'noncurrent long-term debt');
 // A reported aggregate short-term-borrowing fact takes priority. Commercial
 // paper is a supported component for AAPL’s verified capital-structure mapping.
 // Missing debt is never interpreted as zero; unrelated investment assets do not count.
 const shortTermDebt=required(sameBalance(['ShortTermBorrowings'])??(symbol==='AAPL'?sameBalance(['CommercialPaper']):undefined),'reported short-term borrowing component');
 const shares=required(rows(data,['EntityCommonStockSharesOutstanding','CommonStockSharesOutstanding'],'shares',now,false)[0],'latest reported shares outstanding');
 if(shares.end<revenue.end)throw new IngestionError('STALE_SHARE_COUNT','The latest reported share count predates the selected annual report. No current market-cap estimate was invented.');
 if(revenue.value<=0||priorRevenue.value<=0||equity.value<=0||eps.value<=0||shares.value<=0||[debtCurrent.value,debtNoncurrent.value,shortTermDebt.value,dividends.value].some(v=>v<0))throw new IngestionError('UNSUPPORTED_FINANCIAL_STATE','Non-positive denominators or negative debt/dividends require a specialized research mapping; no substitute valuation was invented.');
 const filingUrls:Record<string,string>={};const recent=sub.filings?.recent;
 if(!recent||!Array.isArray(recent.accessionNumber)||!Array.isArray(recent.primaryDocument))throw new IngestionError('SEC_FILING_INDEX','SEC submission metadata lacks primary filing documents.');
 for(const fact of [revenue,priorRevenue,operatingIncome,eps,dividends,equity,debtCurrent,debtNoncurrent,shortTermDebt,shares]){
  const index=recent.accessionNumber.findIndex(a=>a===fact.accession),doc=recent.primaryDocument[index];
  if(index<0||typeof doc!=='string'||!/^[-A-Za-z0-9_.]+\.html?$/.test(doc))throw new IngestionError('SEC_FILING_INDEX','A selected fact does not map to a primary SEC filing in the verified index.');
  filingUrls[fact.accession]=`https://www.sec.gov/Archives/edgar/data/${Number(identity.cik)}/${fact.accession.replace(/-/g,'')}/${doc}`;
 }
 return {cik:identity.cik,name:data.entityName,annualEnd:revenue.end,balanceEnd:equity.end,annualFiled:revenue.filed,annual:{revenue,priorRevenue,operatingIncome,eps,dividends},balance:{equity,debtCurrent,debtNoncurrent,shortTermDebt,shares},debtDefinition:'Current and noncurrent long-term debt plus separately reported short-term borrowings/commercial paper; excludes lease liabilities. AAPL commercial paper mapping is explicit; absence is never zero.',sector:identity.sector,exchange:sub.exchanges[sub.tickers.indexOf(symbol)]??'',filingUrls,warnings:['Ratios use dated annual financials and the latest reported balance sheet, not a silently constructed TTM statement.','Market capitalization is a price-times-latest-reported-shares proxy; later buybacks/issuances may change actual shares.','P/E and dividend yield use the latest annual diluted EPS and declared annual dividend, not forward forecasts.']};
}
export function factExcerpt(f:SecFact):string{return `SEC XBRL ${f.tag} (${f.unit}): ${f.value}; ${f.start?'period '+f.start+' to ': 'as of '}${f.end}; ${f.form} filed ${f.filed}; accession ${f.accession}. This is a structured reported fact, not a verbatim prose quotation.`;}
