/** Bounded, read-only public-source requests. No automatic retry after refusals. */
export class IngestionError extends Error {
  constructor(public code:string,message:string){super(message);this.name='IngestionError';}
}
export async function sourceJson(url:string,headers:Record<string,string>,fetcher:typeof fetch=fetch,maxBytes=15_000_000):Promise<unknown>{
  let response:Response;
  try{response=await fetcher(url,{headers,signal:AbortSignal.timeout(30_000),redirect:'error'});}catch{throw new IngestionError('SOURCE_UNAVAILABLE','Source request failed or timed out. No access workaround or retry was attempted.');}
  if(!response.ok)throw new IngestionError('SOURCE_HTTP_'+response.status,`Source returned HTTP ${response.status}. Stop and respect the provider’s access/rate policy; no workaround was attempted.`);
  const reader=response.body?.getReader();if(!reader)throw new IngestionError('EMPTY_SOURCE','Source returned no body.');
  let total=0;const chunks:Uint8Array[]=[];
  try{for(;;){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new IngestionError('SOURCE_TOO_LARGE','Source response exceeded the bounded size limit.');}chunks.push(value);}}catch(error){if(error instanceof IngestionError)throw error;throw new IngestionError('SOURCE_READ_FAILED','The complete source body could not be read.');}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new IngestionError('SOURCE_INVALID_JSON','Source did not return valid JSON.');}
}
