import type { Firestore, DocumentReference, DocumentData } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { firebaseAdmin } from '../firebase/admin';
import { encodeRecord, decodeRecord, type StoredJson } from '../firebase/codec';
import { getUserRoot, ownerKey } from './persistence';
import { secretCipher, type CipherRecord } from './cipher';
import { calculatePortfolio } from '../../lib/finance/math';
import type { PortfolioTrade } from '../../lib/finance/contracts';
import { HttpError } from '../../lib/server/http';
export interface MergeResult {
    ok: true;
    counts: Record<string, number>;
    conflicts: string[];
    sourcePreserved: true;
}
interface MergeDeps {
    db: Firestore;
    rootForUser: (userId: string) => DocumentReference;
    verifyToken: (token: string) => Promise<Pick<DecodedIdToken, 'uid' | 'aud' | 'iss' | 'firebase' | 'iat'>>;
    projectId: string;
    cipher: {
        encrypt: typeof secretCipher.encrypt;
        decrypt: typeof secretCipher.decrypt;
    };
    now?: () => number;
    maxDocuments?: number;
}
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
export function isCipherRecord(v: unknown): v is CipherRecord { return plain(v) && v.version === 1 && v.algorithm === 'A256GCM' && typeof v.purpose === 'string'; }
/** Recursively rebind secrets, including compressed records. Plaintext credential-shaped fields are refused. */
export async function rebindWorkspaceValue(value: unknown, source: string, target: string, cipher: MergeDeps['cipher'], depth = 0): Promise<unknown> {
    if (depth > 40)
        throw new HttpError(409, 'Stored settings are too deeply nested to merge safely.', 'MERGE_INVALID_DATA');
    if (isCipherRecord(value)) {
        const plaintext = await cipher.decrypt(source, value.purpose, value);
        return cipher.encrypt(target, value.purpose, plaintext);
    }
    if (plain(value) && value.encoding === 'gzip-json-v1') {
        const decoded = decodeRecord(value as unknown as StoredJson);
        return encodeRecord(await rebindWorkspaceValue(decoded, source, target, cipher, depth + 1));
    }
    if (Array.isArray(value))
        return Promise.all(value.map(v => rebindWorkspaceValue(v, source, target, cipher, depth + 1)));
    if (!plain(value))
        return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (/^(apiKey|api_key|accessToken|refreshToken|password|secret|key)$/i.test(key) && typeof item === 'string' && item)
            throw new HttpError(409, 'An unencrypted credential-shaped setting cannot be merged. Save it securely first.', 'MERGE_PLAINTEXT_SECRET');
        out[key] = key === 'namespace' && item === 'account:' + ownerKey(source) ? 'account:' + ownerKey(target) : await rebindWorkspaceValue(item, source, target, cipher, depth + 1);
    }
    return out;
}
export function createWorkspaceMergeService(deps: MergeDeps) {
    const now = deps.now ?? Date.now, root = deps.rootForUser;
    return async function merge(targetUserId: string, sourceIdToken: string, targetIdToken: string): Promise<MergeResult> {
        if (!sourceIdToken || !targetIdToken || sourceIdToken.length > 16000 || targetIdToken.length > 16000)
            throw new HttpError(401, 'Both authenticated account tokens are required.', 'MERGE_AUTH');
        let sourceToken: Awaited<ReturnType<MergeDeps['verifyToken']>>, targetToken: typeof sourceToken;
        try {
            [sourceToken, targetToken] = await Promise.all([deps.verifyToken(sourceIdToken), deps.verifyToken(targetIdToken)]);
        }
        catch {
            throw new HttpError(401, 'The account verification expired. Sign in again without clearing the guest workspace.', 'MERGE_AUTH');
        }
        if ([sourceToken, targetToken].some(t => t.aud !== deps.projectId || t.iss !== `https://securetoken.google.com/${deps.projectId}`))
            throw new HttpError(403, 'Both identities must belong to this Firebase project.', 'MERGE_PROJECT');
        if ([sourceToken, targetToken].some(t => !Number.isFinite(t.iat) || now() / 1000 - t.iat > 300 || t.iat > now() / 1000 + 60))
            throw new HttpError(401, 'Refresh both account tokens before merging.', 'MERGE_TOKEN_AGE');
        const sourceId = 'firebase:' + sourceToken.uid, targetId = 'firebase:' + targetToken.uid;
        if (targetId !== targetUserId || sourceId === targetId || sourceToken.firebase?.sign_in_provider !== 'anonymous' || targetToken.firebase?.sign_in_provider !== 'google.com')
            throw new HttpError(403, 'Merge requires a distinct anonymous source and the signed-in Google destination.', 'MERGE_IDENTITY');
        const sourceRoot = root(sourceId), targetRoot = root(targetId), sourceHash = ownerKey(sourceId), marker = targetRoot.collection('platform_merges').doc(sourceHash);
        const token = crypto.randomUUID();
        let fenced = false;
        let sourceGeneration = 0, targetGeneration = 0;
        const completed = await marker.get();
        if (completed.get('status') === 'completed')
            return completed.get('result') as MergeResult;
        const assertFence = async (tx: FirebaseFirestore.Transaction) => { const [s, t] = await Promise.all([tx.get(sourceRoot), tx.get(targetRoot)]); if ([s, t].some(row => row.get('mergeToken') !== token || row.get('mergeLeaseUntil') < now()))
            throw new HttpError(409, 'Workspace merge lease changed. Retry safely; the guest source is preserved.', 'MERGE_FENCE'); };
        try {
            await deps.db.runTransaction(async (tx) => { const [s, t, done, ...active] = await Promise.all([tx.get(sourceRoot), tx.get(targetRoot), tx.get(marker), ...['runs', 'platform_jobs'].flatMap(name => [tx.get(sourceRoot.collection(name).where('status', 'in', ['queued', 'running']).limit(1)), tx.get(targetRoot.collection(name).where('status', 'in', ['queued', 'running']).limit(1))])]); if (done.get('status') === 'completed')
                throw new HttpError(409, 'This merge already completed. Retry to retrieve its result.', 'MERGE_COMPLETED'); for (const row of [s, t])
                if (row.get('erasing') && !(row.get('mergeToken') && row.get('mergeLeaseUntil') < now()))
                    throw new HttpError(409, 'A workspace is being cleared or merged. Retry after it finishes.', 'MERGE_BUSY'); if (active.some(rows => rows.size > 0))
                throw new HttpError(409, 'Finish or cancel active research in both workspaces before merging.', 'MERGE_ACTIVE_JOB'); sourceGeneration = s.get('memoryGeneration') ?? 0; targetGeneration = t.get('memoryGeneration') ?? 0; const fence = { erasing: true, mergeToken: token, mergeStartedAt: now(), mergeLeaseUntil: now() + 180000 }; tx.set(sourceRoot, fence, { merge: true }); tx.set(targetRoot, fence, { merge: true }); });
            fenced = true;
            const collected: {
                path: string;
                data: DocumentData;
            }[] = [];
            let bytes = 0;
            const maximum = deps.maxDocuments ?? 5000;
            async function walk(ref: DocumentReference, prefix = '') {
                for (const collection of await ref.listCollections()) {
                    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
                    for (;;) {
                        let query = collection.orderBy('__name__').limit(20);
                        if (last)
                            query = query.startAfter(last);
                        const page = await query.get();
                        for (const doc of page.docs) {
                            const data = doc.data(), path = prefix + collection.id + '/' + doc.id;
                            bytes += Buffer.byteLength(JSON.stringify(data));
                            if (collected.length >= maximum || bytes > 16000000)
                                throw new HttpError(413, 'Workspace merge exceeds the bounded copy limit. Export and archive older research first.', 'MERGE_LIMIT');
                            collected.push({ path, data });
                            await walk(doc.ref, path + '/');
                        }
                        if (page.size < 20)
                            break;
                        last = page.docs[page.docs.length - 1];
                    }
                }
            }
            await walk(sourceRoot);
            const targetTrades = await targetRoot.collection('portfolio_trades').limit(2001).get();
            const ledger = new Map(targetTrades.docs.map(d => [d.id, d.data() as PortfolioTrade]));
            for (const doc of collected.filter(d => /^portfolio_trades\/[^/]+$/.test(d.path)))
                if (!ledger.has(doc.path.split('/')[1]))
                    ledger.set(doc.path.split('/')[1], doc.data as PortfolioTrade);
            if (ledger.size > 2000)
                throw new HttpError(409, 'Combined portfolio exceeds the transaction limit. Neither workspace was removed.', 'MERGE_TRADE_LIMIT');
            try {
                calculatePortfolio([...ledger.values()], [], { costBasis: 'fifo', now: new Date(now()) });
            }
            catch {
                throw new HttpError(409, 'The combined portfolio ledger would be invalid. Reconcile conflicting trades before merging.', 'MERGE_LEDGER_INVALID');
            }
            const prepared: {
                path: string;
                data: DocumentData;
            }[] = [];
            for (const doc of collected) {
                const data = await rebindWorkspaceValue(doc.data, sourceId, targetId, deps.cipher) as DocumentData;
                if (doc.path === 'platform_memory/active' && data.record) {
                    const snapshot = decodeRecord<Record<string, unknown>>(data.record);
                    const valid = snapshot.generation === sourceGeneration;
                    const generation = valid ? targetGeneration : -1;
                    data.generation = generation;
                    data.record = encodeRecord({ ...snapshot, generation });
                }
                if (doc.path.startsWith('platform_memory_archives/')) {
                    data.originGeneration = doc.data.generation ?? null;
                    data.generation = targetGeneration;
                }
                prepared.push({ path: doc.path, data });
            }
            // Adding every missing buy before any sell keeps each interrupted destination ledger prefix long-only valid.
            prepared.sort((a, b) => { const rank = (d: typeof a) => /^portfolio_trades\/[^/]+$/.test(d.path) ? d.data.side === 'BUY' ? 0 : 1 : 2; return rank(a) - rank(b) || a.path.localeCompare(b.path); });
            const counts: Record<string, number> = {}, conflicts: string[] = [];
            let batch: typeof prepared = [], size = 0;
            async function commit() { if (!batch.length)
                return; const current = batch; batch = []; size = 0; const committed = await deps.db.runTransaction(async (tx) => { await assertFence(tx); const targets = await Promise.all(current.map(d => tx.get(deps.db.doc(targetRoot.path + '/' + d.path)))); const copied: string[] = [], existing: string[] = []; for (let i = 0; i < current.length; i++) {
                const d = current[i], ref = deps.db.doc(targetRoot.path + '/' + d.path);
                if (targets[i].exists) {
                    existing.push(d.path);
                    continue;
                }
                tx.set(ref, d.data);
                copied.push(d.path);
            } return { copied, existing }; }); conflicts.push(...committed.existing); for (const path of committed.copied) {
                const namespace = path.split('/')[0];
                counts[namespace] = (counts[namespace] ?? 0) + 1;
            } }
            for (const d of prepared) {
                const n = Buffer.byteLength(JSON.stringify(d.data));
                if (batch.length >= 40 || size + n > 4000000)
                    await commit();
                batch.push(d);
                size += n;
            }
            await commit();
            const result: MergeResult = { ok: true, counts, conflicts, sourcePreserved: true };
            await deps.db.runTransaction(async (tx) => { await assertFence(tx); tx.set(marker, { status: 'completed', sourceHash, result, completedAt: new Date(now()).toISOString() }); });
            return result;
        }
        finally {
            if (fenced) {
                await deps.db.runTransaction(async (tx) => { const [s, t] = await Promise.all([tx.get(sourceRoot), tx.get(targetRoot)]); for (const [ref, row] of [[sourceRoot, s], [targetRoot, t]] as const)
                    if (row.get('mergeToken') === token)
                        tx.set(ref, { erasing: false, mergeToken: null, mergeStartedAt: null, mergeLeaseUntil: null, erasedAt: now() }, { merge: true }); });
            }
        }
    };
}
export async function mergeWorkspace(targetUserId: string, sourceIdToken: string, targetIdToken: string) {
    const admin = firebaseAdmin();
    const projectId = admin.auth.app.options.projectId;
    if (!projectId)
        throw new HttpError(503, 'Firebase project is not configured.', 'MERGE_PROJECT');
    return createWorkspaceMergeService({ db: admin.db, rootForUser: getUserRoot, // Standard JWT validation avoids broad Auth-directory IAM. Revocation is subject to normal token lifetime; fresh issuance is required above.
        verifyToken: token => admin.auth.verifyIdToken(token, false), projectId, cipher: secretCipher })(targetUserId, sourceIdToken, targetIdToken);
}
