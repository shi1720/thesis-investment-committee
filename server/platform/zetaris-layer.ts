import {createHash} from 'node:crypto';
import type {ProviderResult} from '../../lib/finance/contracts';
import {validateObservationEnvelope,sha256,observationNames} from '../../scripts/observation-contract.mjs';
export type FinancialObservationKind='quote'|'history'|'fundamentals'|'news'|'sec-facts';
export interface ZetarisLayerReceipt {provider:'Zetaris';status:'verified'|'failed'|'disabled'|'not_applicable';actual:boolean;queriedAt:string|null;ownerHash?:string;recordKey?:string;payloadHash?:string;view?:string;sourceAsOf:string|null;message:string}
export type LayeredObservation<T>=T&{dataLayer:ZetarisLayerReceipt};
export interface ZetarisDeliveryDiagnostic {component:'zetaris_observation';phase:'request_identity'|'endpoint'|'request_canonicalization'|'transport'|'response_read'|'response_canonicalization'|'receipt_binding';httpStatus?:number}
export interface ZetarisLayerOptions {instrumentKey?:string;startedAt?:number;fetcher?:typeof fetch;env?:Record<string,string|undefined>;signal?:AbortSignal;onDiagnostic?:(value:ZetarisDeliveryDiagnostic)=>void}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const obj=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
/** Every usable observation is read back from actual Zetaris before consumers receive it. */
export async function roundTripFinancialObservation<T extends ProviderResult<unknown>>(userId:string,kind:FinancialObservationKind,input:T,options:ZetarisLayerOptions={}):Promise<LayeredObservation<T>>{
 const startedAt=options.startedAt??Date.now(),env=options.env??process.env,base=env.THESIS_ZETARIS_LAYER_URL,key=env.THESIS_ZETARIS_LAYER_KEY;
 const sourceAsOf=input.provenance?.asOf??null;
 const receipt:ZetarisLayerReceipt={provider:'Zetaris',status:'failed',actual:false,queriedAt:null,sourceAsOf,message:'The financial observation could not be verified through Zetaris.'};
 const fail=(message:string)=>({status:'unavailable',data:null,provenance:input.provenance,warnings:[...input.warnings,message],...('issuer'in input?{issuer:null}:{}),...('factEvidence'in input?{factEvidence:[]}:{}),...('filings'in input?{filings:[]}:{}),dataLayer:{...receipt,message}} as unknown as LayeredObservation<T>);
 if(!['ok','partial'].includes(input.status)||input.data===null)return{...input,dataLayer:{...receipt,status:'not_applicable',message:'No usable financial observation was supplied. No value was fabricated.'}};
 if(!base||!key){if(env.THESIS_ZETARIS_LAYER_REQUIRED==='true'||base||key)return fail('Zetaris is required but its protected observation bridge is not configured.');return{...input,dataLayer:{...receipt,status:'disabled',message:'Zetaris observation delivery is disabled. This result is not sponsor-verified.'}}}
 let phase:ZetarisDeliveryDiagnostic['phase']='request_identity',httpStatus:number|undefined;
 try{
  if(!userId||userId.length>2000||!['quote','history','fundamentals','news','sec-facts'].includes(kind))throw Error();
  phase='endpoint';
  const endpoint=new URL(base);if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/'&&endpoint.pathname!=='')throw Error();if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw Error();
  const {dataLayer:prior,...value}=input as T&{dataLayer?:unknown};void prior;
  phase='request_canonicalization';
  const original=validateObservationEnvelope(value),ownerHash=hash('thesis-observation-owner:'+userId),recordKey=hash(kind+'\0'+(options.instrumentKey??'')+'\0'+original.hash);
  phase='transport';
  const response=await(options.fetcher??fetch)(new URL('/private-observations/roundtrip',endpoint),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({ownerHash,kind,recordKey,envelope:original.value,startedAt}),signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});
  httpStatus=response.status;
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error()}
  phase='response_read';
  const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>600000){await reader.cancel();throw Error()}chunks.push(value)}}finally{reader.releaseLock()}
  const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength}
  phase='response_canonicalization';const body=obj(JSON.parse(new TextDecoder().decode(all))),out=obj(body.receipt),returned=validateObservationEnvelope(body.envelope);
  phase='receipt_binding';
  if(out.provider!=='Zetaris'||out.ownerHash!==ownerHash||out.recordKey!==recordKey||out.payloadHash!==original.hash||out.view!==observationNames(ownerHash).view||out.actual!==true||typeof out.queriedAt!=='string'||!Number.isFinite(Date.parse(out.queriedAt))||returned.hash!==original.hash||sha256(returned.json)!==original.hash)throw Error();
  return{...returned.value as T,dataLayer:{...receipt,status:'verified',actual:true,queriedAt:out.queriedAt,ownerHash,recordKey,payloadHash:original.hash,view:out.view as string,message:'Actual normalized source data was staged and queried through the owner-scoped Zetaris view.'}};
 }catch{const diagnostic:ZetarisDeliveryDiagnostic={component:'zetaris_observation',phase,...(httpStatus!==undefined?{httpStatus}:{})};try{if(options.onDiagnostic)options.onDiagnostic(diagnostic);else console.warn(JSON.stringify(diagnostic))}catch{/* Diagnostics never change delivery gates. */}return fail('Zetaris delivery or round-trip validation failed. Native source data was withheld rather than bypassing the required data layer.')}
}
export async function eraseZetarisObservations(userId:string,options:Pick<ZetarisLayerOptions,'env'|'fetcher'>={}):Promise<boolean>{
 const env=options.env??process.env;if(!env.THESIS_ZETARIS_LAYER_URL||!env.THESIS_ZETARIS_LAYER_KEY)return env.THESIS_ZETARIS_LAYER_REQUIRED!=='true';
 try{const ownerHash=hash('thesis-observation-owner:'+userId),response=await(options.fetcher??fetch)(new URL('/private-observations/erase',env.THESIS_ZETARIS_LAYER_URL),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+env.THESIS_ZETARIS_LAYER_KEY,'content-type':'application/json'},body:JSON.stringify({ownerHash}),signal:AbortSignal.timeout(30000)});if(!response.ok){await response.body?.cancel();return false}const reader=response.body?.getReader();if(!reader)return false;let size=0,text='';const decoder=new TextDecoder();try{for(;;){const value=await reader.read();if(value.done)break;size+=value.value.byteLength;if(size>4096){await reader.cancel();return false}text+=decoder.decode(value.value,{stream:true})}}finally{reader.releaseLock()}const body=obj(JSON.parse(text+decoder.decode()));return body.erased===true&&body.ownerHash===ownerHash&&typeof body.erasedAt==='number'&&Number.isSafeInteger(body.erasedAt)&&body.erasedAt>0}catch{return false}
}
