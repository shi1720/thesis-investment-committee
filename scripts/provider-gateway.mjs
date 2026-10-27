// Narrow bridge to operator-owned local sponsor services. This is not a proxy
// for arbitrary URLs, SQL, models, filesystem paths, or administration APIs.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function authorizeGateway(supplied, key) {
  const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
  const expected = Buffer.from('Bearer ' + key);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export function validateGatewayRequest(path, method, body) {
  if (method === 'GET' && path === '/v1/models') return 'nightshift';
  if (method !== 'POST' || !body || typeof body !== 'object') return null;
  if (path === '/api/v1.0/sql-editor/sqls/run') {
    const market = "'(?:US|India|China|UAE)'";
    const query = new RegExp(`^SELECT \\* FROM thesis\\.research_universe(?: WHERE market IN \\(${market}(?:, ${market}){0,3}\\))? LIMIT 1000$`);
    return query.test(body.sql) && body.limit === 1000 && body.source === 'SqlEditor' && /^[a-f0-9-]{36}$/.test(body.queryId) ? 'zetaris' : null;
  }
  if (path === '/v1/chat/completions') {
    const models = ['local-runtime/qwen2-5-7b-instruct-q4-k-m', 'local-runtime/nemotron-mini-4b-instruct-q4-k-m'];
    const keys = ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'response_format'];
    if (Object.keys(body).some(k => !keys.includes(k)) || !models.includes(body.model) || body.stream !== false || !Number.isInteger(body.max_tokens) || body.max_tokens < 64 || body.max_tokens > 1050 || !(body.temperature >= 0 && body.temperature <= 1)) return null;
    if (!Array.isArray(body.messages) || body.messages.length !== 2 || body.messages.some(m => !['system', 'user'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 20000)) return null;
    return 'nightshift';
  }
  return null;
}

export function startGateway() {
  const key = readFileSync(process.env.THESIS_GATEWAY_KEY_FILE, 'utf8').trim();
  if (key.length < 40) throw new Error('A dedicated high entropy gateway key is required.');
  const status = JSON.parse(readFileSync(process.env.THESIS_CONNECTION_STATUS_FILE, 'utf8'));
  const parseEnv = path => Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const at = l.indexOf('='); return [l.slice(0, at), l.slice(at + 1).replace(/^(['"])(.*)\1$/, '$2')]; }));
  const platform = parseEnv(status.platformCredentialsEnvPath);
  let access, validUntil = 0, orgId;
  let active = 0;
  async function login(force = false) {
    if (!force && access && Date.now() < validUntil) return;
    const response = await fetch(status.zetaris.loginUrl, { headers: { Authorization: 'Basic ' + Buffer.from(platform.ZETARIS_ADMIN_EMAIL + ':' + platform.ZETARIS_ADMIN_PASSWORD).toString('base64') }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Zetaris authentication unavailable');
    const data = await response.json();
    if (typeof data.idToken !== 'string' || !data.orgId) throw new Error('Zetaris login contract failed');
    access = data.idToken; orgId = String(data.orgId); validUntil = Date.now() + 10 * 60_000;
  }
  const server = createServer(async (request, response) => {
    if (!authorizeGateway(request.headers.authorization, key)) { response.writeHead(401).end(); return; }
    if (active >= 2) { response.writeHead(429).end(); return; }
    active++;
    try {
      const incoming = []; let incomingBytes = 0;
      for await (const chunk of request) { incomingBytes += chunk.byteLength; if (incomingBytes > 40000) { response.writeHead(413).end(); return; } incoming.push(chunk); }
      const input = Buffer.concat(incoming).toString('utf8');
      let body; if (input) { try { body = JSON.parse(input); } catch { response.writeHead(400).end(); return; } }
      const path = new URL(request.url, 'http://gateway.local').pathname;
      const service = validateGatewayRequest(path, request.method, body);
      if (!service) { response.writeHead(403).end(); return; }
      const headers = { 'Content-Type': 'application/json' };
      if (service === 'zetaris') { await login(); headers.Authorization = 'Bearer ' + access; headers['X-Org-ID'] = orgId; headers['X-Request-ID'] = body.queryId; }
      else { headers.Authorization = 'Bearer ' + readFileSync(status.nightshiftTokenPath, 'utf8').trim(); headers['meterless-app'] = 'thesis'; headers['meterless-scope'] = 'user'; }
      const origin = service === 'zetaris' ? new URL(status.zetaris.baseUrl).origin : new URL(status.nightshift.baseUrl).origin;
      const upstream = await fetch(origin + path, { method: request.method, headers, body: input || undefined, signal: AbortSignal.timeout(180000) });
      if (service === 'zetaris' && upstream.status === 401) { validUntil = 0; access = undefined; }
      const reader = upstream.body.getReader(); let bytes = 0; const chunks = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); throw new Error('Upstream response exceeded limit'); } chunks.push(Buffer.from(value)); }
      response.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(upstream.headers.get('x-meterless-receipt-id') ? { 'x-meterless-receipt-id': upstream.headers.get('x-meterless-receipt-id') } : {}) });
      response.end(Buffer.concat(chunks));
    } catch { if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' }); response.end('{"error":"Local research services are unavailable. Retry later or use sample mode."}'); }
    finally { active--; }
  });
  server.listen(Number(process.env.PORT || 5197), '127.0.0.1', () => console.log('Thesis provider gateway listening on loopback. Request contents and credentials are not logged.'));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startGateway();
