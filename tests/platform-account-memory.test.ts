import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore, DocumentReference } from 'firebase-admin/firestore';
import { createWorkspaceMergeService, rebindWorkspaceValue } from '../server/platform/account';
import { createPlatformMemoryService, type PlatformMemorySnapshot } from '../server/platform/memory';
import { ownerKey } from '../server/platform/persistence';
import { secretCipher } from '../server/platform/cipher';
import { encodeRecord, decodeRecord } from '../server/firebase/codec';
class FakeDb {
    rows = new Map<string, Record<string, unknown>>();
    retryNext = false;
    failTransactionAt = 0;
    transactions = 0;
    private tail: Promise<unknown> = Promise.resolve();
    doc(path: string) { return new Doc(this, path); }
    collection(path: string) { return new Collection(this, path); }
    async runTransaction<T>(callback: (tx: any) => Promise<T>): Promise<T> { const execute = async () => { this.transactions++; if (this.transactions === this.failTransactionAt)
        throw Error('Synthetic transient transaction failure'); const attempt = async (commit: boolean) => { let wrote = false; const writes: (() => void)[] = []; const tx = { get: async (ref: Doc | Collection) => { if (wrote)
            throw Error('Read after write'); return ref instanceof Doc ? ref.snapshot() : ref.get(); }, set: (ref: Doc, value: Record<string, unknown>, options?: {
            merge?: boolean;
        }) => { wrote = true; writes.push(() => ref.setNow(value, options)); }, create: (ref: Doc, value: Record<string, unknown>) => { wrote = true; writes.push(() => { if (this.rows.has(ref.path))
            throw Error('Duplicate create'); ref.setNow(value); }); }, delete: (ref: Doc) => { wrote = true; writes.push(() => this.rows.delete(ref.path)); } }; const value = await callback(tx); if (commit)
        for (const w of writes)
            w(); return value; }; if (this.retryNext) {
        this.retryNext = false;
        await attempt(false);
    } return attempt(true); }; const result = this.tail.then(execute); this.tail = result.catch(() => { }); return result; }
}
class Snap {
    constructor(public ref: Doc, private row: Record<string, unknown> | undefined) { }
    get id() { return this.ref.id; }
    get exists() { return this.row !== undefined; }
    get(key: string) { return this.row?.[key]; }
    data() { return this.row === undefined ? undefined : structuredClone(this.row); }
}
class Doc {
    constructor(private db: FakeDb, public path: string) { }
    get id() { return this.path.split('/').at(-1)!; }
    collection(name: string) { return new Collection(this.db, this.path + '/' + name); }
    snapshot() { return new Snap(this, this.db.rows.get(this.path)); }
    async get() { return this.snapshot(); }
    setNow(value: Record<string, unknown>, options?: {
        merge?: boolean;
    }) { this.db.rows.set(this.path, structuredClone({ ...options?.merge ? this.db.rows.get(this.path) : {}, ...value })); }
    async set(v: Record<string, unknown>, o?: {
        merge?: boolean;
    }) { this.setNow(v, o); }
    async delete() { this.db.rows.delete(this.path); }
    async listCollections() { const names = new Set<string>(); for (const p of this.db.rows.keys())
        if (p.startsWith(this.path + '/'))
            names.add(p.slice(this.path.length + 1).split('/')[0]); return [...names].map(n => this.collection(n)); }
}
class Collection {
    constructor(private db: FakeDb, public path: string, private filters: {
        field: string;
        op: string;
        value: unknown;
    }[] = [], private cap = Infinity, private after?: string) { }
    get id() { return this.path.split('/').at(-1)!; }
    doc(id: string = crypto.randomUUID()) { return new Doc(this.db, this.path + '/' + id); }
    where(field: string, op: string, value: unknown) { return new Collection(this.db, this.path, [...this.filters, { field, op, value }], this.cap, this.after); }
    orderBy(_field: string) { return this; }
    limit(cap: number) { return new Collection(this.db, this.path, this.filters, cap, this.after); }
    startAfter(doc: Snap) { return new Collection(this.db, this.path, this.filters, this.cap, doc.id); }
    async get() { const docs = [...this.db.rows.keys()].filter(p => p.startsWith(this.path + '/') && !p.slice(this.path.length + 1).includes('/')).sort().map(p => new Doc(this.db, p).snapshot()).filter(d => !this.after || d.id > this.after).filter(d => this.filters.every(f => f.op === 'in' ? (f.value as unknown[]).includes(d.get(f.field)) : f.op === '<=' ? Number(d.get(f.field)) <= Number(f.value) : d.get(f.field) === f.value)).slice(0, this.cap); return { docs, size: docs.length }; }
}
const guest = 'firebase:guest', google = 'firebase:google', now = Date.parse('2026-10-27T12:00:00Z');
const root = (db: FakeDb, id: string) => db.doc('thesis_users/' + ownerKey(id));
function mergeService(db: FakeDb, overrides: Record<string, unknown> = {}) { return createWorkspaceMergeService({ db: db as unknown as Firestore, rootForUser: id => root(db, id) as unknown as DocumentReference, projectId: 'project-test', verifyToken: async (token) => ({ uid: token === 'guest-token' ? 'guest' : 'google', aud: 'project-test', iat: Math.floor(now / 1000), iss: 'https://securetoken.google.com/project-test', firebase: { identities: {}, sign_in_provider: token === 'guest-token' ? 'anonymous' : 'google.com' } }), cipher: secretCipher, now: () => now, ...overrides }); }
const memoryService = (db: FakeDb) => createPlatformMemoryService({ db: db as unknown as Firestore, rootForUser: id => root(db, id) as unknown as DocumentReference, now: () => now });
function transaction(id: string, side: 'BUY' | 'SELL' = 'BUY', quantity = 1) { return { id, instrument: { symbol: 'SYNTHETIC', market: 'US', exchange: 'NYSE', currency: 'USD' }, side, quantity, price: 10, fees: 0, currency: 'USD', executedAt: '2026-01-01' }; }
test('merge requires both verified same-project tokens and exact Google destination', async () => { const db = new FakeDb(); await assert.rejects(() => mergeService(db)('firebase:attacker', 'guest-token', 'google-token')); assert.equal(db.rows.size, 0); await assert.rejects(() => mergeService(db, { verifyToken: async () => { throw Error('invalid token'); } })(google, 'guest-token', 'google-token')); await assert.rejects(() => mergeService(db, { projectId: 'other-project' })(google, 'guest-token', 'google-token')); assert.equal(db.rows.size, 0); });
test('merge copies private records, target wins conflicts, source is preserved and retry is idempotent', async () => { const db = new FakeDb(); await root(db, guest).collection('platform_reports').doc('r1').set({ record: encodeRecord({ summary: 'Guest synthetic decision' }) }); await root(db, guest).collection('platform_watchlist').doc('same').set({ note: 'Guest note' }); await root(db, google).collection('platform_watchlist').doc('same').set({ note: 'Google note' }); const run = mergeService(db); const first = await run(google, 'guest-token', 'google-token'); assert.equal(first.sourcePreserved, true); assert.equal(first.counts.platform_reports, 1); assert.ok(first.conflicts.includes('platform_watchlist/same')); assert.equal((await root(db, google).collection('platform_watchlist').doc('same').get()).get('note'), 'Google note'); assert.ok((await root(db, guest).collection('platform_reports').doc('r1').get()).exists); assert.equal((await root(db, guest).get()).get('erasing'), false); const second = await run(google, 'guest-token', 'google-token'); assert.deepEqual(second, first); });
test('merge re-encrypts nested compressed credentials for destination owner AAD', async () => { const previous = process.env.THESIS_SETTINGS_KEY; process.env.THESIS_SETTINGS_KEY = Buffer.alloc(32, 7).toString('base64url'); try {
    const db = new FakeDb(), sealed = await secretCipher.encrypt(guest, 'data:finnhub', 'synthetic-private-test-key');
    await root(db, guest).collection('private_settings').doc('market_data').set({ settings: { providers: { finnhub: { key: sealed } } } });
    await root(db, guest).collection('platform_reports').doc('compressed').set({ record: encodeRecord({ nested: sealed }) });
    await mergeService(db)(google, 'guest-token', 'google-token');
    const target = (await root(db, google).collection('private_settings').doc('market_data').get()).get('settings') as any;
    assert.equal(await secretCipher.decrypt(google, 'data:finnhub', target.providers.finnhub.key), 'synthetic-private-test-key');
    await assert.rejects(() => secretCipher.decrypt(guest, 'data:finnhub', target.providers.finnhub.key));
    const stored = (await root(db, google).collection('platform_reports').doc('compressed').get()).get('record');
    const decoded = decodeRecord<any>(stored as any);
    assert.equal(await secretCipher.decrypt(google, 'data:finnhub', decoded.nested), 'synthetic-private-test-key');
}
finally {
    if (previous === undefined)
        delete process.env.THESIS_SETTINGS_KEY;
    else
        process.env.THESIS_SETTINGS_KEY = previous;
} });
test('unsafe plaintext credential preflight fails without copying or deleting the source', async () => { const db = new FakeDb(); await root(db, guest).collection('private_settings').doc('bad').set({ settings: { apiKey: 'synthetic-plaintext-test-key' } }); await assert.rejects(() => mergeService(db)(google, 'guest-token', 'google-token')); assert.equal((await root(db, google).collection('private_settings').doc('bad').get()).exists, false); assert.equal((await root(db, guest).collection('private_settings').doc('bad').get()).exists, true); assert.equal((await root(db, guest).get()).get('erasing'), false); });
test('combined portfolio preflight rejects invalid ledger and active jobs before copying', async () => { const db = new FakeDb(); await root(db, guest).collection('portfolio_trades').doc('sell').set(transaction('sell', 'SELL', 2)); await assert.rejects(() => mergeService(db)(google, 'guest-token', 'google-token')); assert.equal((await root(db, google).collection('portfolio_trades').doc('sell').get()).exists, false); const active = new FakeDb(); await root(active, guest).collection('platform_jobs').doc('j').set({ status: 'queued' }); await assert.rejects(() => mergeService(active)(google, 'guest-token', 'google-token')); assert.equal((await root(active, guest).get()).exists, false); });
test('copy limits preserve source and release write fences', async () => { const db = new FakeDb(); await root(db, guest).collection('platform_reports').doc('a').set({ x: 1 }); await root(db, guest).collection('platform_reports').doc('b').set({ x: 2 }); await assert.rejects(() => mergeService(db, { maxDocuments: 1 })(google, 'guest-token', 'google-token')); assert.equal((await root(db, guest).collection('platform_reports').get()).size, 2); assert.equal((await root(db, google).collection('platform_reports').get()).size, 0); assert.equal((await root(db, google).get()).get('mergeToken'), null); });
test('real official H-MEM stores and recalls production decisions with source provenance', async () => { const db = new FakeDb(), m = memoryService(db); await m.remember(guest, { id: 'decision-1', summary: 'Technology investment excluded because volatility exceeds the risk budget.', goal: 'Capital preservation', symbols: ['SYNTHETIC'], sourceIds: ['price-source-1'], memoryGeneration: 0 }); const result = await m.recall(guest, 'Technology investment risk volatility budget'); assert.equal(result.reused, true); assert.equal(result.count, 1); assert.match(result.context, /Historical user decision context/); const stored = (await root(db, guest).collection('platform_memory').doc('active').get()).get('record'); const snapshot = decodeRecord<PlatformMemorySnapshot>(stored as any); assert.equal(snapshot.state.records[0].source, 'platform-decision:decision-1'); assert.ok(snapshot.state.records[0].provenance.refs!.includes('price-source-1')); assert.equal(snapshot.state.records[0].namespace, 'account:' + ownerKey(guest)); assert.equal((await m.recall(google, 'Technology investment risk volatility')).count, 0); });
test('production memory is idempotent, bounded and archives evictions rather than recalling them', async () => { const db = new FakeDb(), m = memoryService(db); for (let i = 0; i < 132; i++)
    await m.remember(guest, { id: 'decision-' + i, summary: 'Investment portfolio risk review number ' + i, symbols: ['SYNTHETIC'] }); await m.remember(guest, { id: 'decision-131', summary: 'Duplicate should not add context' }); const row = await root(db, guest).collection('platform_memory').doc('active').get(); const snapshot = decodeRecord<PlatformMemorySnapshot>(row.get('record') as any); assert.equal(snapshot.state.records.length, 128); assert.ok(snapshot.ledger.length <= 256); assert.ok((await root(db, guest).collection('platform_memory_archives').get()).size > 0); assert.equal(snapshot.state.records.some(r => r.source === 'platform-decision:decision-0'), false); });
test('clear increments memory generation and a late job cannot resurrect deleted context', async () => { const db = new FakeDb(), m = memoryService(db); await m.remember(guest, { id: 'old', summary: 'Old risk decision', memoryGeneration: 0 }); await m.clear(guest); await assert.rejects(() => m.remember(guest, { id: 'late', summary: 'Old job finished late', memoryGeneration: 0 })); assert.equal((await m.recall(guest, 'Old risk decision')).reused, false); await m.remember(guest, { id: 'new', summary: 'New market risk decision', memoryGeneration: 1 }); assert.equal((await m.recall(guest, 'New market risk decision')).reused, true); });
test('memory honors workspace erasure/fence and cannot write an old request epoch', async () => { const db = new FakeDb(), m = memoryService(db); await root(db, guest).set({ erasing: true }); await assert.rejects(() => m.remember(guest, { id: 'x', summary: 'Refused while merging' })); await root(db, guest).set({ erasing: false, erasedAt: now }); await assert.rejects(() => m.remember(guest, { id: 'x', summary: 'Old in-flight decision', startedAt: now - 1 })); });
test('merge rebinds official memory namespace and valid generation without resurrecting stale memory', async () => { const db = new FakeDb(), m = memoryService(db); await root(db, google).set({ memoryGeneration: 4 }); await m.remember(guest, { id: 'r', summary: 'Healthcare research risk decision', memoryGeneration: 0 }); await mergeService(db)(google, 'guest-token', 'google-token'); const result = await m.recall(google, 'Healthcare research risk decision'); assert.equal(result.reused, true); const db2 = new FakeDb(), m2 = memoryService(db2); await m2.remember(guest, { id: 'old', summary: 'Deleted context' }); await root(db2, guest).set({ memoryGeneration: 1 }, { merge: true }); await mergeService(db2)(google, 'guest-token', 'google-token'); assert.equal((await m2.recall(google, 'Deleted context')).reused, false); });
test('non-anonymous sources and non-Google targets cannot initiate a merge', async () => { for (const invalid of ['source', 'target']) {
    const db = new FakeDb();
    const merge = mergeService(db, { verifyToken: async (token: string) => ({ uid: token === 'guest-token' ? 'guest' : 'google', aud: 'project-test', iat: Math.floor(now / 1000), iss: 'https://securetoken.google.com/project-test', firebase: { identities: {}, sign_in_provider: token === 'guest-token' ? (invalid === 'source' ? 'password' : 'anonymous') : (invalid === 'target' ? 'password' : 'google.com') } }) });
    await assert.rejects(() => merge(google, 'guest-token', 'google-token'));
    assert.equal(db.rows.size, 0);
} });
test('a stale erasure request cannot clear memory created after a newer workspace epoch', async () => { const db = new FakeDb(), m = memoryService(db); await m.remember(guest, { id: 'new', summary: 'New independently completed risk decision' }); await root(db, guest).set({ erasedAt: now }, { merge: true }); const stale = createPlatformMemoryService({ db: db as unknown as Firestore, rootForUser: id => root(db, id) as unknown as DocumentReference, now: () => now, requestStartedAt: () => now - 100 }); await assert.rejects(() => stale.clear(guest)); assert.ok((await root(db, guest).collection('platform_memory').doc('active').get()).exists); });
test('both merge tokens must be freshly issued without requiring user-directory lookup', async () => { const db = new FakeDb(); for (const iat of [Math.floor(now / 1000) - 301, Math.floor(now / 1000) + 61]) {
    const merge = mergeService(db, { verifyToken: async (token: string) => ({ uid: token === 'guest-token' ? 'guest' : 'google', iat, aud: 'project-test', iss: 'https://securetoken.google.com/project-test', firebase: { identities: {}, sign_in_provider: token === 'guest-token' ? 'anonymous' : 'google.com' } }) });
    await assert.rejects(() => merge(google, 'guest-token', 'google-token'));
} assert.equal(db.rows.size, 0); });
test('an interrupted merge leaves a valid destination ledger and a retry finishes without deleting the guest', async () => { const db = new FakeDb(); for (let j = 0; j < 50; j++)
    await root(db, guest).collection('portfolio_trades').doc('b' + j).set(transaction('b' + j)); await root(db, guest).collection('portfolio_trades').doc('sell').set(transaction('sell', 'SELL', 50)); db.failTransactionAt = 3; const merge = mergeService(db); await assert.rejects(() => merge(google, 'guest-token', 'google-token')); const partial = await root(db, google).collection('portfolio_trades').get(); assert.equal(partial.size, 40); assert.ok(partial.docs.every(d => d.get('side') === 'BUY')); assert.equal((await root(db, guest).collection('portfolio_trades').get()).size, 51); db.failTransactionAt = 0; await merge(google, 'guest-token', 'google-token'); assert.equal((await root(db, google).collection('portfolio_trades').get()).size, 51); assert.equal((await root(db, guest).collection('portfolio_trades').get()).size, 51); });
test('imported memory audit archives follow the destination deletion generation', async () => { const db = new FakeDb(), m = memoryService(db); await root(db, guest).set({ memoryGeneration: 10 }); await root(db, google).set({ memoryGeneration: 2 }); await m.remember(guest, { id: 'guest-decision', summary: 'Historical investment risk' }); await root(db, guest).collection('platform_memory_archives').doc('guest-archive').set({ generation: 10, createdAt: '2026-10-27', record: encodeRecord({ entries: [], evictedRecords: [] }) }); await mergeService(db)(google, 'guest-token', 'google-token'); assert.equal((await root(db, google).collection('platform_memory_archives').doc('guest-archive').get()).get('generation'), 2); await m.clear(google); assert.equal((await root(db, google).collection('platform_memory_archives').get()).size, 0); });
