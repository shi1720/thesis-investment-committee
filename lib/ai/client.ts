import {AIError} from './errors';
import type {AIProvider,AIUsageReceipt,CatalogModel,Completion,CompletionRequest} from './types';
type ObjectValue=Record<string,unknown>;
const object=(v:unknown):ObjectValue=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as ObjectValue:{};
const text=(v:unknown):string=>typeof v==='string'?v:'';
const count=(v:unknown):number|null=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const nonnegative=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export const validModelId=(value:string)=>/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(value)&&!value.includes('..');
const safeId=(value:unknown):string|null=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(value)?value:null;
const BASES:Record<Exclude<AIProvider,'nightshift'>,string>={nvidia:'https://integrate.api.nvidia.com/v1',openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',gemini:'https://generativelanguage.googleapis.com/v1beta'};
export interface AIClientOptions {fetcher?:typeof fetch;nightshiftBaseUrl?:string;catalogTimeoutMs?:number}
/** No account-controlled base URLs. Only the operator can configure the Nightshift route. */
export class AIClient {
 private fetcher:typeof fetch;
 constructor(private options:AIClientOptions={}){this.fetcher=options.fetcher??fetch}
 private base(provider:AIProvider){if(provider!=='nightshift')return BASES[provider];const value=this.options.nightshiftBaseUrl;if(!value)throw new AIError('operator_unavailable','The operator Nightshift route is unavailable.');const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new AIError('operator_unavailable','The operator route is invalid.');return url.toString().replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1')}
 private headers(provider:AIProvider,key:string){
  if(!key||key.length>4096||/[\s\u0000-\u001f\u007f]/.test(key))throw new AIError('missing_key',`Add a valid ${provider} API key in Settings.`);
  return {'content-type':'application/json',...(provider==='anthropic'?{authorization:`Bearer ${key}`,'anthropic-version':'2026-10-21'}:provider==='gemini'?{'x-goog-api-key':key}:{authorization:`Bearer ${key}`}),...(provider==='nightshift'?{'meterless-app':'thesis','meterless-scope':'user'}:{})};
 }
 private async request(provider:AIProvider,url:string,key:string,body:unknown|undefined,timeoutMs:number,signal?:AbortSignal):Promise<{body:ObjectValue;response:Response}>{
  const attempts=body===undefined?2:1;
  for(let attempt=0;attempt<attempts;attempt++){
   let response:Response;
   try{response=await this.fetcher(url,{method:body===undefined?'GET':'POST',redirect:'error',headers:this.headers(provider,key),body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)})}
   catch(error){if(error instanceof AIError)throw error;if(signal?.aborted)throw new AIError('cancelled','Research was cancelled.',409);if(attempt+1<attempts)continue;throw new AIError('provider_timeout',body===undefined?'Model discovery could not reach the provider.':'The model request did not complete. It may have been billed; inspect provider usage before retrying.',504)}
   if(!response.ok){await response.body?.cancel().catch(()=>{});if(response.status===402)throw new AIError('provider_billing','The provider requires billing or available credits. Check the provider account before trying again.',402);if(response.status>=500&&attempt+1<attempts)continue;throw new AIError(response.status===401||response.status===403?'provider_unauthorized':response.status===429?'provider_quota':'provider_http',response.status===401||response.status===403?'The provider rejected this key or model access.':response.status===429?'Provider quota or rate limit reached.':`The provider returned HTTP ${response.status}. Check model compatibility and account availability.`,response.status===429?429:502)}
   const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>2_000_000){await response.body?.cancel().catch(()=>{});throw new AIError('response_limit','Provider response exceeded the payload limit.',502)}
   if(!response.body)throw new AIError('provider_response','The provider returned no readable body.',502);
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel().catch(()=>{});throw new AIError('response_limit','Provider response exceeded the payload limit.',502)}chunks.push(value)}}catch(error){if(error instanceof AIError)throw error;throw new AIError('provider_response','The provider response could not be read.',502)}finally{reader.releaseLock()}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
   try{const parsed:unknown=JSON.parse(new TextDecoder().decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return{body:parsed as ObjectValue,response}}catch{throw new AIError('provider_response','The provider returned invalid JSON.',502)}
  }
  throw new AIError('provider_unavailable','The provider is unavailable.',502);
 }
 async listModels(provider:AIProvider,key:string,signal?:AbortSignal):Promise<CatalogModel[]>{
  const result:CatalogModel[]=[],seen=new Set<string>(),cursors=new Set<string>();let cursor='';
  for(let page=0;page<10;page++){
   const suffix=provider==='anthropic'?`/models?limit=100${cursor?`&after_id=${encodeURIComponent(cursor)}`:''}`:provider==='gemini'?`/models?pageSize=100${cursor?`&pageToken=${encodeURIComponent(cursor)}`:''}`:'/models';
   const{body}=await this.request(provider,this.base(provider)+suffix,key,undefined,this.options.catalogTimeoutMs??15_000,signal),rows=provider==='gemini'?body.models:body.data;
   if(!Array.isArray(rows))throw new AIError('catalog_invalid','The provider returned an invalid model catalog.',502);
   for(const value of rows){const row=object(value),id=text(row.id||row.name).replace(provider==='gemini'?/^models\//:/^$/,'');if(!validModelId(id)||seen.has(id))continue;
    if(row.lifecycle==='retired'||row.lifecycle==='deprecated')continue;
    if(/(?:^|[\/_-])(?:embed(?:ding)?s?|rerank(?:er|ing)?|moderation|whisper|transcri(?:be|ption)|tts|audio|realtime|image(?:gen)?|guard)(?:[\/_-]|$)/i.test(id))continue;
    if(provider==='gemini'&&(!Array.isArray(row.supportedGenerationMethods)||!row.supportedGenerationMethods.includes('generateContent')))continue;
    const created=typeof row.created==='number'&&Number.isFinite(row.created)?new Date(row.created*1000):null;
    const release=typeof row.created_at==='string'?row.created_at:created&&Number.isFinite(created.getTime())?created.toISOString():undefined;
    const createdAt=release&&Number.isFinite(Date.parse(release))?release:undefined;
    const name=text(row.display_name||row.displayName||id).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180)||id;
    result.push({id,name,...(createdAt?{createdAt}:{}),...(count(row.inputTokenLimit??row.max_input_tokens)?{contextWindow:count(row.inputTokenLimit??row.max_input_tokens)!}:{}),capability:provider==='anthropic'||provider==='gemini'?'text':'unverified',inferenceTested:false});seen.add(id);
    if(result.length>1000)throw new AIError('catalog_limit','The model catalog exceeded the supported account limit.',502);
   }
   const next=provider==='gemini'?text(body.nextPageToken):body.has_more?text(body.last_id||object(rows.at(-1)).id):'';
   if(!next)return result;
   if(provider==='openai'||provider==='nvidia'||provider==='nightshift')throw new AIError('catalog_invalid','Unexpected pagination in model catalog.',502);
   if(cursors.has(next))throw new AIError('catalog_invalid','The provider repeated its catalog cursor.',502);cursors.add(next);cursor=next;
  }
  throw new AIError('catalog_limit','The model catalog exceeded the bounded pagination limit.',502);
 }
 async complete(input:CompletionRequest):Promise<Completion>{
  if(!validModelId(input.model))throw new AIError('invalid_model','Choose a valid model from the live catalog.');
  if(!Number.isSafeInteger(input.maxOutputTokens)||input.maxOutputTokens<64||input.maxOutputTokens>16_000)throw new AIError('invalid_budget','The model output budget is invalid.');
  if(input.prompt.length+input.system.length>180_000)throw new AIError('prompt_limit','Research context exceeded the prompt limit.');
  const startedAt=new Date().toISOString(),start=Date.now();
  const receipt:AIUsageReceipt={id:crypto.randomUUID(),role:input.role,provider:input.provider,requestedModel:input.model,responseModel:null,startedAt,latencyMs:0,inputTokens:null,outputTokens:null,reasoningTokens:null,reportedCostUsd:null,requestId:null,status:'failed'};
  const body=input.provider==='openai'?{model:input.model,store:false,instructions:input.system,input:input.prompt,max_output_tokens:input.maxOutputTokens}:input.provider==='anthropic'?{model:input.model,max_tokens:input.maxOutputTokens,system:input.system,messages:[{role:'user',content:input.prompt}]}:input.provider==='gemini'?{systemInstruction:{parts:[{text:input.system}]},contents:[{role:'user',parts:[{text:input.prompt}]}],generationConfig:{maxOutputTokens:input.maxOutputTokens,responseMimeType:'application/json'}}:{model:input.model,messages:[{role:'system',content:input.system},{role:'user',content:input.prompt}],max_tokens:input.maxOutputTokens,stream:false};
  const path=input.provider==='openai'?'/responses':input.provider==='anthropic'?'/messages':input.provider==='gemini'?`/models/${encodeURIComponent(input.model)}:generateContent`:'/chat/completions';
  try{
   const{body:data,response}=await this.request(input.provider,this.base(input.provider)+path,input.apiKey,body,Math.min(Math.max(input.timeoutMs??60_000,1),150_000),input.signal);
   receipt.latencyMs=Date.now()-start;receipt.requestId=safeId(response.headers.get('x-request-id')||response.headers.get('request-id')||data.id||data.responseId);receipt.responseModel=safeId(object(data.meterless).routed_model||data.model||data.modelVersion);
   const usage=object(data.usage||data.usageMetadata);receipt.inputTokens=count(usage.input_tokens??usage.prompt_tokens??usage.promptTokenCount);if(input.provider==='anthropic'&&receipt.inputTokens!==null)receipt.inputTokens+=(count(usage.cache_creation_input_tokens)??0)+(count(usage.cache_read_input_tokens)??0);receipt.reasoningTokens=count(object(usage.output_tokens_details).thinking_tokens??object(usage.output_tokens_details).reasoning_tokens??object(usage.completion_tokens_details).reasoning_tokens??usage.thoughtsTokenCount);
   const output=count(usage.output_tokens??usage.completion_tokens??usage.candidatesTokenCount);receipt.outputTokens=input.provider==='gemini'&&output!==null?output+(receipt.reasoningTokens??0):output;
   receipt.reportedCostUsd=nonnegative(object(object(data.meterless).cost).actual_usd);
   let answer='';let complete=false;
   if(input.provider==='openai'){complete=data.status==='completed';answer=(Array.isArray(data.output)?data.output:[]).flatMap(v=>{const item=object(v);return item.type==='message'&&Array.isArray(item.content)?item.content:[]}).map(v=>{const item=object(v);return item.type==='output_text'?text(item.text):''}).join('\n')}
   else if(input.provider==='anthropic'){complete=data.stop_reason==='end_turn';answer=(Array.isArray(data.content)?data.content:[]).map(v=>{const item=object(v);return item.type==='text'?text(item.text):''}).join('\n')}
   else if(input.provider==='gemini'){const candidate=object(Array.isArray(data.candidates)?data.candidates[0]:null);complete=candidate.finishReason==='STOP';const parts=object(candidate.content).parts;answer=(Array.isArray(parts)?parts:[]).map(v=>{const item=object(v);return item.thought===true?'':text(item.text)}).join('\n')}
   else{const choice=object(Array.isArray(data.choices)?data.choices[0]:null);complete=choice.finish_reason==='stop';answer=text(object(choice.message).content)}
   if(!complete){receipt.status='incomplete';throw new AIError('model_incomplete','The model did not complete its answer. No partial narrative was accepted.',502,receipt)}
   if(!answer.trim()||answer.length>100_000){receipt.status='invalid_output';throw new AIError('model_empty','The model did not return a usable bounded answer.',502,receipt)}
   receipt.status='completed';return{text:answer.trim(),receipt};
  }catch(error){receipt.latencyMs=Date.now()-start;const safe=error instanceof AIError?error:new AIError('provider_response','The model response could not be processed.',502);if(!safe.receipt)safe.receipt=receipt;safe.receipt.errorCode=safe.code;throw safe}
 }
}
