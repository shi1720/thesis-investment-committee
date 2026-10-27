/** Optional private personal-research importer. Never writes vendor prices into public source. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {existsSync,realpathSync} from 'node:fs';
import {resolve,dirname,sep,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fetchSecSources,extractSecFinancials,verifiedUsIdentities,type VerifiedUsSymbol} from '../lib/ingestion/sec';
import {fetchPersonalYahooPrices,parsePersonalYahooPrices} from '../lib/ingestion/yahoo-personal';
import {buildPersonalStock} from '../lib/ingestion/build-stock';
import {IngestionError} from '../lib/ingestion/http';
import type {Stock} from '../lib/contracts';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function option(args:string[],flag:string):string|undefined{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined;}
export function privateOutputPath(path:string):string{
 const requested=resolve(path);let parent=requested;const tail:string[]=[];
 while(!existsSync(parent)){tail.unshift(basename(parent));const next=dirname(parent);if(next===parent)break;parent=next;}
 const out=resolve(realpathSync(parent),...tail),inside=out===repository||out.startsWith(repository+sep);
 if(inside&&!out.startsWith(resolve(repository,'work')+sep))throw new IngestionError('PUBLIC_OUTPUT_REFUSED','Raw vendor data may only be written outside this repository or inside its ignored work directory. Never commit or redistribute it.');
 return out;
}
function rows(stocks:Stock[]){return {
 prices:stocks.map(s=>({symbol:s.symbol,market:s.market,exchange:s.exchange,currency:s.currency,as_of:s.asOf,price:s.price,annual_return:s.annualReturn,annual_volatility:s.annualVolatility,max_drawdown:s.maxDrawdown,prices_json:JSON.stringify(s.prices),sample:false})),
 fundamentals:stocks.map(s=>({symbol:s.symbol,market:s.market,as_of:s.asOf,name:s.name,sector:s.sector,revenue_growth:s.revenueGrowth,operating_margin:s.operatingMargin,debt_to_equity:s.debtToEquity,pe:s.pe,dividend_yield:s.dividendYield,market_cap_bn:s.marketCapBn,quality:s.quality,catalyst:s.catalyst,risk:s.risk,thesis:s.thesis,sample:false})),
 filings:stocks.map(s=>({symbol:s.symbol,market:s.market,as_of:s.asOf,evidence_json:JSON.stringify(s.evidence),sample:false}))};}
const jsonl=(values:unknown[])=>values.map(v=>JSON.stringify(v)).join('\n')+'\n';
const quote=(value:unknown)=>`"${String(value).replace(/"/g,'""')}"`;
const csv=(values:Record<string,unknown>[])=>{const keys=Object.keys(values[0]);return keys.map(quote).join(',')+'\n'+values.map(v=>keys.map(k=>quote(v[k])).join(',')).join('\n')+'\n';};
export async function importMarketData(args:string[]){
 if(args.includes('--commercial')||args.includes('--public'))throw new IngestionError('COMMERCIAL_PROVIDER_REQUIRED','This importer cannot power commercial or public redistribution. Obtain a documented licensed provider entitlement first.');
 const flags=new Set(['--personal-research','--symbols','--cache','--output']);
 for(let i=0;i<args.length;i++){if(!flags.has(args[i]))throw new IngestionError('INVALID_IMPORT_ARGUMENT','Unknown ingestion argument. Use only --personal-research, --symbols, --cache and --output.');if(args[i]!=='--personal-research'){if(!args[i+1]||args[i+1].startsWith('--'))throw new IngestionError('INVALID_IMPORT_ARGUMENT','A required ingestion argument value is missing.');i++;}}
 if(!args.includes('--personal-research'))throw new IngestionError('PERSONAL_USE_REQUIRED','Pass --personal-research only for an owner-private personal research workflow. No commercial or redistribution permission is supplied.');
 const outArg=option(args,'--output');if(!outArg)throw new IngestionError('PRIVATE_OUTPUT_REQUIRED','Provide --output with an explicitly private/ignored staging directory.');
 const output=privateOutputPath(outArg),cache=option(args,'--cache'),symbols=[...new Set((option(args,'--symbols')??'AAPL').split(','))];
 if(!symbols.length||symbols.length>2||symbols.some(s=>!Object.prototype.hasOwnProperty.call(verifiedUsIdentities,s)))throw new IngestionError('UNVERIFIED_COVERAGE','Only verified AAPL/MSFT US identities are supported. No India, China or UAE actual-data coverage is claimed.');
 const stocks:Stock[]=[],lineage:Record<string,unknown>[]=[],rejected:{symbol:string;code:string;reason:string}[]=[],now=new Date();
 for(const rawSymbol of symbols){const symbol=rawSymbol as VerifiedUsSymbol;
  try{
   const sources=cache?{facts:JSON.parse(await readFile(resolve(cache,`sec-${symbol.toLowerCase()}-companyfacts.json`),'utf8')),submissions:JSON.parse(await readFile(resolve(cache,`sec-${symbol.toLowerCase()}-submissions.json`),'utf8'))}:await fetchSecSources(verifiedUsIdentities[symbol].cik,process.env.SEC_USER_AGENT??'');
   const financials=extractSecFinancials(symbol,sources.facts,sources.submissions,now);
   const series=cache?parsePersonalYahooPrices(symbol,JSON.parse(await readFile(resolve(cache,`yahoo-${symbol.toLowerCase()}-chart.json`),'utf8')),now,true):await fetchPersonalYahooPrices(symbol,true,now);
   const built=buildPersonalStock(symbol,financials,series);stocks.push(built.stock);lineage.push(built.lineage);
  }catch(error){rejected.push({symbol,code:error instanceof IngestionError?error.code:'SOURCE_READ_FAILED',reason:error instanceof IngestionError?error.message:'A required source could not be read. No invented fallback security was created.'});}
 }
 await mkdir(output,{recursive:true});
 const manifest={schema:'thesis.private-personal-import.v1',createdAt:now.toISOString(),mode:cache?'validate-existing-private-cache':'bounded-public-source-fetch',synthetic:false,scope:'private-personal-research-only',commercialRightsVerified:false,redistributionAllowed:false,accepted:stocks.map(s=>({symbol:s.symbol,market:s.market,asOf:s.asOf,observations:s.prices.length})),rejected,notice:'Actual observed/SEC reported inputs, with explicit derived heuristics and dated valuation proxies. Yahoo is unofficial and intended for personal use. Do not publish, sell, redistribute or put raw vendor data in a public repository. Provider terms govern your use.'};
 await writeFile(resolve(output,'import-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 if(stocks.length){
  const sourceRows=rows(stocks);await writeFile(resolve(output,'prices.json'),JSON.stringify(sourceRows.prices,null,2)+'\n');await writeFile(resolve(output,'prices.jsonl'),jsonl(sourceRows.prices));await writeFile(resolve(output,'fundamentals.csv'),csv(sourceRows.fundamentals));await writeFile(resolve(output,'filings.json'),JSON.stringify(sourceRows.filings,null,2)+'\n');await writeFile(resolve(output,'filings.jsonl'),jsonl(sourceRows.filings));await writeFile(resolve(output,'research-universe.json'),JSON.stringify(stocks,null,2)+'\n');await writeFile(resolve(output,'field-lineage.json'),JSON.stringify(lineage,null,2)+'\n');
  const sql=(await readFile(resolve(repository,'data/zetaris/register.sql'),'utf8')).replaceAll('thesis_prices','thesis_personal_prices').replaceAll('thesis_fundamentals','thesis_personal_fundamentals').replaceAll('thesis_filings','thesis_personal_filings').replaceAll('CONTAINER thesis','CONTAINER thesis_personal').replaceAll('customer-data/shared/thesis/','customer-data/thesis-personal/').replaceAll('customer-data/thesis/','customer-data/thesis-personal/').replace('All rows below are synthetic. A real query is not real-market-data proof.','These rows contain private personal-use vendor data and dated SEC facts. Do not redistribute.').replaceAll('Synthetic','Private personal-use').replaceAll('synthetic','private personal-use');
  await writeFile(resolve(output,'register-private.sql'),sql);
 }
 return {accepted:manifest.accepted,rejected,stagingDirectory:output,scope:manifest.scope,commercialRightsVerified:false,redistributionAllowed:false,preparedView:'thesis_personal.research_universe',stageAndQueryExecuted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){importMarketData(process.argv.slice(2)).then(summary=>{console.log(JSON.stringify(summary));if(!summary.accepted.length)process.exitCode=2;}).catch(error=>{console.error(JSON.stringify({success:false,code:error instanceof IngestionError?error.code:'IMPORT_FAILED',message:error instanceof IngestionError?error.message:'Import failed. Review private source files; no secret or raw vendor response is included here.'}));process.exitCode=1;});}
