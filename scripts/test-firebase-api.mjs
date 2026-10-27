import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Creates only disposable, empty anonymous workspaces, then removes their data.
const base = process.env.THESIS_TEST_URL || 'https://thesis-investing.web.app';
if (!['thesis-investing.web.app', '127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use the dedicated Thesis deployment or loopback.');
const config = JSON.parse(await readFile('web/firebase-config.json', 'utf8'));
const profiles = { markets: ['US', 'India'], targetReturn: 12, maxVolatility: 25, maxDrawdown: 25, horizonMonths: 36, capital: 25000, baseCurrency: 'USD', excludedSectors: [], mode: 'sample' };
const checks = [];
const accounts = [];
async function authRequest(action, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${config.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: base + '/' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Disposable account ${action} failed: ${data.error?.message}`);
  return data;
}
async function call(path, token, method = 'GET', body, extra = {}) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: base, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
function pass(name) { checks.push(name); console.log('PASS ' + name); }
try {
  for (let i = 0; i < 2; i++) accounts.push(await authRequest('signUp', { returnSecureToken: true }));
  const [one, two] = accounts.map(a => a.idToken);
  assert.equal((await call('/api/runs')).status, 401); pass('Anonymous HTTP caller cannot read history');
  assert.equal((await call('/api/runs', null, 'GET', undefined, { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'fake@example.test' })).status, 401); pass('Sites identity header spoofing rejected');
  assert.equal((await call('/api/runs', 'invalid-token')).status, 401); pass('Forged Firebase token rejected');
  const boot = await call('/api/bootstrap', one); assert.equal(boot.status, 200); assert.equal(boot.data.user.signedIn, true); assert.equal(boot.data.universe.length, 20);
  const directDatabase = await fetch(`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/thesis-research/documents/thesis_users?pageSize=1`, { headers: { Authorization: `Bearer ${one}` } });
  assert.equal(directDatabase.status, 403, 'Browser identities must not bypass the API to list private Firestore workspaces');
  pass('Verified workspace access works while direct client database reads are denied');
  assert.equal((await call('/api/research', one, 'POST', { ...profiles, capital: -1 })).status, 400); pass('Invalid mandate rejected');
  assert.equal((await call('/api/research', one, 'POST', profiles, { Origin: 'https://untrusted.example' })).status, 403); pass('Cross-origin writes rejected');
  assert.equal((await call('/api/research', one, 'POST', { junk: 'x'.repeat(18000) })).status, 413); pass('Oversized body rejected');
  const key = crypto.randomUUID();
  const run = await call('/api/research', one, 'POST', profiles, { 'x-idempotency-key': key });
  assert.equal(run.status, 201, JSON.stringify(run.data)); assert.ok(run.data.opportunities.some(o => o.status === 'qualified')); assert.ok(run.data.opportunities.some(o => o.status === 'excluded')); assert.ok(run.data.events.some(e => e.model === 'Meterless/H-MEM')); pass('Research runs actual risk screening, critique revision and official H-MEM');
  const duplicate = await call('/api/research', one, 'POST', profiles, { 'x-idempotency-key': key }); assert.equal(duplicate.data.id, run.data.id); pass('Idempotent retry returns original decision');
  assert.equal((await call('/api/research', one, 'POST', { ...profiles, targetReturn: 15 }, { 'x-idempotency-key': key })).status, 409); pass('Idempotency key cannot change the mandate');
  assert.equal((await call('/api/runs/' + run.data.id, two)).status, 404); assert.equal((await call('/api/runs/' + run.data.id + '/report', two)).status, 404); pass('A second Firebase account cannot read research or reports');
  const candidate = run.data.opportunities.find(o => o.status === 'qualified');
  const saved = await call('/api/watchlist', one, 'POST', { symbol: candidate.symbol, market: candidate.market, runId: run.data.id, name: 'forged name', note: 'Disposable integration check' }); assert.equal(saved.status, 201); assert.equal(saved.data.name, candidate.name); pass('Saved thesis identity comes from server-owned research');
  const patched = await call('/api/watchlist/' + saved.data.id, one, 'PATCH', { note: 'Review next filing before deciding.' }); assert.equal(patched.data.note, 'Review next filing before deciding.');
  assert.equal((await call('/api/watchlist/' + saved.data.id, two, 'PATCH', { note: 'intrusion' })).status, 404); pass('Notes persist and reject edits from another account');
  const report = await call('/api/runs/' + run.data.id + '/report', one); assert.equal(report.status, 200); assert.ok(report.data.includes('Synthetic sample data')); assert.ok(report.headers.get('content-type').includes('text/html')); pass('Authenticated printable report preserves provenance');
  const conflict = await call('/api/research', one, 'POST', { ...profiles, targetReturn: 40, maxVolatility: 10, maxDrawdown: 10 }); assert.equal(conflict.status, 201); assert.equal(conflict.data.abstained, true); assert.equal(conflict.data.cost.modelCalls, 0); assert.equal(conflict.data.opportunities.some(o => o.status === 'qualified'), false); pass('Conflicting mandate abstains without paid generation');
  const next = await call('/api/research', one, 'POST', profiles); assert.equal(next.status, 201); assert.equal(next.data.memory.reused, true); pass('Official memory is recalled in a later request');
  const exported = await call('/api/account', one); assert.equal(exported.status, 200); assert.equal(exported.data.runs.length, 3); assert.equal(exported.data.watchlist.length, 1); pass('Account export includes persisted runs and notes');
  const deleted = await call('/api/runs/' + run.data.id, one, 'DELETE'); assert.equal(deleted.status, 200); assert.equal((await call('/api/runs/' + run.data.id, one)).status, 404); pass('Run deletion removes access');
  assert.equal((await call('/api/account', one, 'DELETE')).status, 200); const empty = await call('/api/bootstrap', one); assert.equal(empty.data.recentRuns.length, 0); assert.equal(empty.data.watchlist.length, 0); pass('Workspace reset clears research, notes and memory');
  await mkdir('evidence', { recursive: true }); await writeFile('evidence/firebase-api-tests.json', JSON.stringify({ executedAt: new Date().toISOString(), environment: base, disposableAnonymousAccounts: 2, checks: checks.length, results: checks }, null, 2) + '\n');
} finally {
  for (const account of accounts) {
    try { await call('/api/account', account.idToken, 'DELETE'); } catch {}
    try { await authRequest('delete', { idToken: account.idToken }); } catch {}
  }
}
console.log(`${checks.length} Firebase deployment checks passed.`);
