import { getChatGPTUser } from '@/app/chatgpt-auth';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED') { super(message); }
}
export const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status, error.status === 429 ? {'Retry-After':'600'} : {});
  console.error(JSON.stringify({ event: 'request_failed', kind: error instanceof Error ? error.name : 'UnknownError' }));
  return json({ error: 'This request could not be completed. Please retry. Your saved research is safe.', code: 'INTERNAL_ERROR' }, 500);
}
export async function requireUser() {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, 'Sign in to save and manage your research.', 'SIGN_IN_REQUIRED');
  return user;
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'This request must come from Thesis.', 'ORIGIN_REJECTED');
  const site = request.headers.get('sec-fetch-site');
  if (site && !['same-origin','none'].includes(site)) throw new HttpError(403, 'This request must come from Thesis.', 'ORIGIN_REJECTED');
}
export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON with Content-Type application/json.', 'INVALID_CONTENT_TYPE');
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new HttpError(413, 'Request is too large.', 'BODY_TOO_LARGE');
  if (!request.body) throw new HttpError(400, 'A JSON body is required.', 'INVALID_JSON');
  const reader = request.body.getReader();
  let total = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new HttpError(413, 'Request is too large.', 'BODY_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset=0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, 'The request contains invalid JSON.', 'INVALID_JSON'); }
}
export function validId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new HttpError(400, 'Invalid record identifier.', 'INVALID_ID');
  return id;
}
