import { z } from 'zod';
import type { Market, Stock } from '../contracts';
import { ProviderError, serverUrl, type ProviderEnv } from './config';
import { requestJson, type Fetcher } from './http';

const timestamp = z.string().refine(v=>/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) && Number.isFinite(Date.parse(v)), 'A valid ISO date is required');
const evidenceSchema = z.object({ id:z.string().min(1).max(160), title:z.string().min(1).max(500), publisher:z.string().min(1).max(200), url:z.string().min(1).max(2000), asOf:timestamp, kind:z.enum(['filing','prices','macro','methodology']), excerpt:z.string().min(1).max(4000), sample:z.boolean() }).refine(v=>v.url.startsWith('https://') || (v.sample && /^#sample-[a-z0-9-]+$/.test(v.url)), 'Real evidence requires HTTPS; sample anchors must be explicitly synthetic');
const finite = z.number().finite();
export const liveStockSchema = z.object({
  symbol:z.string().min(1).max(40), name:z.string().min(1).max(200), market:z.enum(['US','India','China','UAE']), exchange:z.string().min(1).max(50), currency:z.enum(['USD','INR','CNY','AED','HKD']), sector:z.string().min(1).max(80), price:finite.positive(), annualReturn:finite.min(-100).max(10000), annualVolatility:finite.min(0).max(1000), maxDrawdown:finite.min(0).max(100), revenueGrowth:finite.min(-100).max(10000), operatingMargin:finite.min(-1000).max(100), debtToEquity:finite.min(0).max(100000), pe:finite.min(-10000).max(10000), dividendYield:finite.min(0).max(100), marketCapBn:finite.positive(), quality:finite.min(0).max(100), prices:z.array(finite.positive()).min(61).max(5000), evidence:z.array(evidenceSchema).min(2).max(40), catalyst:z.string().min(1).max(2000), risk:z.string().min(1).max(2000), thesis:z.string().min(1).max(3000), asOf:timestamp,
}).refine(v=>v.evidence.some(e=>e.kind==='prices') && v.evidence.some(e=>e.kind==='filing'), 'Live stocks require both price and filing provenance');

/** Exact endpoint contracts from zetaris/getting-started scripts/query_zetaris.ts and zetaris_sql.py. */
export class ZetarisClient {
  private readonly base: string;
  private readonly mode: 'proxy'|'direct';
  constructor(private readonly env: ProviderEnv, private readonly fetcher?: Fetcher) {
    if (!env.ZETARIS_BASE_URL || !env.ZETARIS_API_KEY || !env.ZETARIS_ORG_ID || !/^\d+$/.test(env.ZETARIS_ORG_ID)) throw new ProviderError('Zetaris','configuration','Set the Zetaris URL, read-only API token and numeric organization ID.');
    this.mode = env.ZETARIS_API_MODE === 'direct' ? 'direct' : 'proxy';
    if (env.ZETARIS_API_MODE && !['proxy','direct'].includes(env.ZETARIS_API_MODE)) throw new ProviderError('Zetaris','configuration','ZETARIS_API_MODE must be proxy or direct.');
    const url=serverUrl(env.ZETARIS_BASE_URL,'Zetaris');
    if (this.mode === 'proxy' && !['','/'].includes(url.pathname)) throw new ProviderError('Zetaris','configuration','Proxy mode requires the Zetaris origin without a path.');
    this.base=url.toString().replace(/\/$/,'');
  }
  async query(sql:string,limit=1000):Promise<unknown> {
    if (!/^\s*SELECT\b/i.test(sql) || /;|--|\/\*/.test(sql)) throw new ProviderError('Zetaris','configuration','Application queries must be a single read-only SELECT statement.');
    if (!Number.isInteger(limit) || limit<1 || limit>1000) throw new ProviderError('Zetaris','configuration','Query limit must be between 1 and 1000.');
    const queryId=crypto.randomUUID();
    const body=this.mode==='direct' ? {queryId,sql,source:'SqlEditor',limit} : {sql,limit,...(this.env.ZETARIS_ENGINE_ID?{engineId:this.env.ZETARIS_ENGINE_ID}:{})};
    const {body:out}=await requestJson('Zetaris',this.base+(this.mode==='direct'?'/sql-editor/sqls/run':'/api/proxy/sql-editor/sqls/run-query'),{method:'POST',headers:{Authorization:`Bearer ${this.env.ZETARIS_API_KEY}`,'X-Org-ID':this.env.ZETARIS_ORG_ID!,'X-Request-ID':queryId,'Content-Type':'application/json'},body:JSON.stringify(body)},{fetcher:this.fetcher,timeoutMs:30_000,attempts:2});
    return out;
  }
  async stocks(selectedMarkets?:Market[]):Promise<Stock[]> {
    const view=this.env.ZETARIS_STOCKS_VIEW??'thesis.research_universe';
    // Object names are config, never a browser-provided SQL fragment.
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){1,2}$/.test(view)) throw new ProviderError('Zetaris','configuration','Zetaris view must be a qualified SQL identifier.');
    const allowed=new Set(['US','India','China','UAE']);
    if(selectedMarkets?.some(m=>!allowed.has(m)))throw new ProviderError('Zetaris','configuration','Unsupported market.');
    const unique=[...new Set(selectedMarkets??[])];
    const filter=unique.length?` WHERE market IN (${unique.map(m=>`'${m}'`).join(', ')})`:'';
    const out=await this.query(`SELECT * FROM ${view}${filter} LIMIT 1000`,1000);
    const rows=extractRows(out);
    if(rows.length===0)throw new ProviderError('Zetaris','invalid_response','Zetaris returned an empty research universe for these markets.');
    const parsed:Stock[]=[];
    for(const row of rows){
      const normalized={...row};
      for(const field of ['prices','evidence'])if(typeof normalized[field]==='string'){try{normalized[field]=JSON.parse(normalized[field] as string)}catch{throw new ProviderError('Zetaris','invalid_response',`Zetaris ${field} field contains invalid JSON.`)}}
      const stock=liveStockSchema.safeParse(normalized);
      if(!stock.success)throw new ProviderError('Zetaris','invalid_response',`Zetaris stock contract failed at ${stock.error.issues[0]?.path.join('.')||'row'}. No unvalidated stocks were accepted.`);
      const sampleFlags=new Set(stock.data.evidence.map(e=>e.sample));
      if(sampleFlags.size!==1)throw new ProviderError('Zetaris','invalid_response','A stock cannot mix synthetic and actual evidence.');
      if(stock.data.evidence.some(e=>e.sample) && this.env.ZETARIS_ALLOW_SAMPLE_DATA!=='true')throw new ProviderError('Zetaris','invalid_response','Synthetic Zetaris records require explicit ZETARIS_ALLOW_SAMPLE_DATA=true and must be labeled sample mode.');
      parsed.push(stock.data);
    }
    if(new Set(parsed.map(s=>s.evidence[0].sample)).size!==1)throw new ProviderError('Zetaris','invalid_response','A research universe cannot mix synthetic and actual stocks.');
    if(new Set(parsed.map(s=>s.market+':'+s.symbol)).size!==parsed.length)throw new ProviderError('Zetaris','invalid_response','Zetaris returned duplicate market-symbol identities.');
    if(unique.length && parsed.some(s=>!unique.includes(s.market)))throw new ProviderError('Zetaris','invalid_response','Zetaris returned a stock outside the requested markets.');
    return parsed;
  }
}

/** Supports JSON object rows and tabular {data,columns} from Zetaris SQL Editor. */
export function extractRows(out:unknown):Record<string,unknown>[] {
  const envelope=out && typeof out==='object'&&!Array.isArray(out)?out as Record<string,unknown>:undefined;
  const nested=envelope?.result && typeof envelope.result==='object'?envelope.result as Record<string,unknown>:undefined;
  const rows=Array.isArray(out)?out:envelope?.data??envelope?.rows??nested?.data??nested?.rows;
  if(!Array.isArray(rows))throw new ProviderError('Zetaris','invalid_response','Zetaris did not return a row array.');
  if(rows.length>1000)throw new ProviderError('Zetaris','invalid_response','Zetaris exceeded the universe row limit.');
  const rawColumns=envelope?.columns??envelope?.schema??nested?.columns;
  const columns=Array.isArray(rawColumns)?rawColumns.map(c=>typeof c==='string'?c:(c&&typeof c==='object'?(c as Record<string,unknown>).name:undefined)):undefined;
  return rows.map(row=>{
    if(Array.isArray(row)){
      if(!columns || columns.length!==row.length || columns.some(c=>typeof c!=='string'))throw new ProviderError('Zetaris','invalid_response','Tabular Zetaris rows require named columns.');
      return Object.fromEntries(columns.map((c,i)=>[c as string,row[i]]));
    }
    if(!row||typeof row!=='object')throw new ProviderError('Zetaris','invalid_response','Zetaris returned a non-object row.');
    return row as Record<string,unknown>;
  });
}
export function fetchZetarisStocks(env:ProviderEnv,markets?:Market[],fetcher?:Fetcher):Promise<Stock[]>{return new ZetarisClient(env,fetcher).stocks(markets)}
