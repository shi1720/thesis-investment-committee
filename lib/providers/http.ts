import { ProviderError } from './config';

export type Fetcher = typeof fetch;
const MAX_RESPONSE_BYTES=2_000_000;
async function boundedBody(response:Response,provider:'Nightshift'|'Zetaris'):Promise<string>{
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>MAX_RESPONSE_BYTES){await response.body?.cancel().catch(()=>{});throw new ProviderError(provider,'invalid_response',`${provider} response exceeds the bounded payload limit.`)}
  if(!response.body)throw new ProviderError(provider,'invalid_response',`${provider} returned an unavailable response body.`);
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_RESPONSE_BYTES){await reader.cancel().catch(()=>{});throw new ProviderError(provider,'invalid_response',`${provider} response exceeds the bounded payload limit.`)}
      chunks.push(value);
    }
  }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError(provider,'invalid_response',`${provider} response body could not be read.`)}
  finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return new TextDecoder().decode(bytes);
}
export async function requestJson(provider: 'Nightshift'|'Zetaris', url: string, init: RequestInit, options: { fetcher?: Fetcher; timeoutMs?: number; attempts?: number } = {}): Promise<{ body: unknown; response: Response; attempts: number }> {
  const fetcher = options.fetcher ?? fetch;
  const attempts = options.attempts ?? 2;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? 30_000) });
    } catch (error) {
      const timeout = error instanceof Error && ['TimeoutError','AbortError'].includes(error.name);
      if (attempt < attempts) continue;
      throw new ProviderError(provider, timeout ? 'timeout' : 'unavailable', `${provider} ${timeout ? 'timed out' : 'could not be reached'}.`, true);
    }
    if ([401,403].includes(response.status)) {
      throw new ProviderError(provider, 'unauthorized', `${provider} rejected its configured credentials.`);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(()=>{});
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < attempts) {
        // Bounded Retry-After; no unbounded upstream-controlled waits.
        const retry = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retry) && retry > 0) await new Promise(resolve => setTimeout(resolve, Math.min(retry * 1000, 500)));
        continue;
      }
      throw new ProviderError(provider, 'unavailable', `${provider} returned HTTP ${response.status}.`, retryable);
    }
    let text: string;
    text=await boundedBody(response,provider);
    try { return { body: JSON.parse(text), response, attempts: attempt }; }
    catch { throw new ProviderError(provider, 'invalid_response', `${provider} did not return JSON. Check its API URL.`); }
  }
  throw new ProviderError(provider, 'unavailable', `${provider} exhausted its retry budget.`);
}
