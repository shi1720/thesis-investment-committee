import aaplSnapshot from '../../data/sec-snapshots/aapl.json';
import msftSnapshot from '../../data/sec-snapshots/msft.json';
import { createHash } from 'node:crypto';
import type { CompanyFundamentals, FundamentalMetric, InstrumentRef, ProviderResult } from '../../lib/finance/contracts';
import { verifiedUsIdentities } from '../../lib/ingestion/sec';
const DAY = 86400000;
const USER_AGENT = 'Thesis public financial research https://github.com/shi1720/thesis-investment-committee';
const REGISTRY = 'https://www.sec.gov/files/company_tickers_exchange.json';
export interface SecNumericEvidence {
    id: string;
    tag: string;
    label: string;
    value: number;
    unit: string;
    start: string | null;
    end: string;
    filed: string;
    accession: string;
    form: string;
    sourceUrl: string;
    excerpt: string;
}
export interface SecFilingItem {
    id: string;
    form: string;
    filed: string;
    reportDate: string | null;
    accession: string;
    primaryDocument: string;
    url: string;
    title: string;
    items: string | null;
}
export interface SecFundamentalsResult extends ProviderResult<CompanyFundamentals> {
    dataMode?: 'fresh_sec_fetch' | 'cached_snapshot';
    snapshot?: {
        sourceRequestedAt: string | null;
        sourceRetrievedAt: string | null;
        submissionsRequestedAt: string | null;
        normalizedAt: string;
        retrievalTimingNote: string;
        sourceUrls: string[];
        sourceSha256: Record<string, string>;
        refresh?: {
            status: string;
            attemptedAt: string;
            warnings: string[];
        };
    };
    issuer: {
        cik: string;
        symbol: string;
        name: string;
    } | null;
    factEvidence: SecNumericEvidence[];
    filings: SecFilingItem[];
}
interface Fact {
    tag: string;
    label: string;
    value: number;
    unit: string;
    start: string | null;
    end: string;
    filed: string;
    accession: string;
    form: string;
}
export interface SecOptions {
    fetcher?: typeof fetch;
    now?: () => Date;
    signal?: AbortSignal;
    userAgent?: string;
    timeoutMs?: number;
    maxRequests?: number;
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown) => typeof v === 'string' ? v : '';
const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const validAccession = (v: unknown): v is string => typeof v === 'string' && /^\d{10}-\d{2}-\d{6}$/.test(v);
class SecError extends Error {
    constructor(readonly status: 'unavailable' | 'rate_limited' | 'invalid_data', message: string, readonly retryAfterSeconds?: number) { super(message); }
}
const transportCooldown = new WeakMap<typeof fetch, {
    until: number;
}>();
let lastRequestAt = 0;
let requestQueue: Promise<unknown> = Promise.resolve();
let queued = 0;
async function paced<T>(work: () => Promise<T>): Promise<T> { if (queued >= 32)
    throw new SecError('rate_limited', 'SEC request queue is full; retry later.', 60); queued++; const next = requestQueue.then(async () => { const delay = Math.max(0, lastRequestAt + 250 - Date.now()); if (delay)
    await new Promise(resolve => setTimeout(resolve, delay)); lastRequestAt = Date.now(); return work(); }); requestQueue = next.catch(() => { }); try {
    return await next;
}
finally {
    queued--;
} }
function filingUrl(cik: string, accession: string, document: string) { return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${document}`; }
function filingsFrom(raw: unknown, cik: string, now: Date): SecFilingItem[] { const recent = object(object(object(raw).filings).recent); const accessions = recent.accessionNumber; if (!Array.isArray(accessions))
    return []; const output: SecFilingItem[] = []; for (let j = 0; j < Math.min(accessions.length, 1500); j++) {
    const accession = accessions[j], form = Array.isArray(recent.form) ? recent.form[j] : null, filed = Array.isArray(recent.filingDate) ? recent.filingDate[j] : null, document = Array.isArray(recent.primaryDocument) ? recent.primaryDocument[j] : null;
    const report = Array.isArray(recent.reportDate) ? recent.reportDate[j] : null, items = Array.isArray(recent.items) ? string(recent.items[j]) : '';
    if (!validAccession(accession) || !validDate(filed) || Date.parse(filed) > now.getTime() || typeof document !== 'string' || !/^[-A-Za-z0-9_./]+$/.test(document) || document.startsWith('/') || document.includes('..') || !['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A', '20-F', '20-F/A', '6-K'].includes(form))
        continue;
    output.push({ id: 'sec-filing-' + accession, form, filed, reportDate: validDate(report) ? report : null, accession, primaryDocument: document, url: filingUrl(cik, accession, document), title: `SEC ${form} filed ${filed}${items ? ' (reported items ' + items.slice(0, 100) + ')' : ''}`, items: items || null });
} return output.sort((a, b) => b.filed.localeCompare(a.filed) || b.accession.localeCompare(a.accession)).slice(0, 30); }
function rows(raw: unknown, tags: string[], unit: string, now: Date): Fact[] { const facts = object(object(raw).facts), gaap = object(facts['us-gaap']), output: Fact[] = []; for (const tag of tags) {
    const concept = object(gaap[tag]), units = object(concept.units), values = units[unit];
    if (!Array.isArray(values))
        continue;
    for (const value of values.slice(0, 25000)) {
        const r = object(value);
        if (typeof r.val !== 'number' || !Number.isFinite(r.val) || !validDate(r.end) || !validDate(r.filed) || Date.parse(r.end) > now.getTime() || Date.parse(r.filed) > now.getTime() || !validAccession(r.accn) || !['10-K', '10-K/A', '10-Q', '10-Q/A'].includes(string(r.form)) || r.start !== undefined && !validDate(r.start))
            continue;
        output.push({ tag, label: string(concept.label) || tag, value: r.val, unit, start: validDate(r.start) ? r.start : null, end: r.end, filed: r.filed, accession: r.accn, form: string(r.form) });
    }
} return output; }
function unique(facts: Fact[]): Fact | undefined { if (!facts.length)
    return undefined; const values = new Set(facts.map(f => f.value)); return values.size === 1 ? facts[0] : undefined; }
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;
/** Pure parser. Facts only combine when unit, fiscal context and accession actually match. */
export function normalizeSecFundamentals(instrument: InstrumentRef, cik: string, rawFacts: unknown, rawSubmissions: unknown, options: {
    now?: Date;
    fetchedAt?: string;
} = {}): SecFundamentalsResult {
    const now = options.now ?? new Date(), facts = object(rawFacts), sub = object(rawSubmissions), tickers = Array.isArray(sub.tickers) ? sub.tickers : [];
    const symbol = instrument.symbol.toUpperCase();
    if (!/^\d{10}$/.test(cik) || String(facts.cik).padStart(10, '0') !== cik || String(sub.cik).padStart(10, '0') !== cik || !tickers.some(t => typeof t === 'string' && t.toUpperCase() === symbol))
        throw new SecError('invalid_data', 'SEC issuer CIK and submission ticker identity do not match the requested listing.');
    const filings = filingsFrom(rawSubmissions, cik, now), filingMap = new Map(filings.map(f => [f.accession, f]));
    const warnings = ['Official SEC reported facts are dated statements, not current market quotes or independently audited product calculations.', 'Quote-dependent valuation, capitalization and dividend-yield fields remain unavailable. Fiscal periods and filing publication dates are separate.'];
    const revenues = rows(rawFacts, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'], 'USD', now).filter(f => f.start && ((days(f.start, f.end) >= 75 && days(f.start, f.end) <= 105) || (days(f.start, f.end) >= 335 && days(f.start, f.end) <= 395)) && filingMap.get(f.accession)?.filed === f.filed).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
    let revenue: Fact | undefined;
    for (const candidate of revenues) {
        if (now.getTime() - Date.parse(candidate.end) > 550 * DAY)
            continue;
        const same = revenues.filter(f => f.tag === candidate.tag && f.start === candidate.start && f.end === candidate.end && f.accession === candidate.accession);
        const chosen = unique(same);
        if (chosen) {
            revenue = chosen;
            break;
        }
    }
    const context = (tags: string[], base: Fact, unit = 'USD') => unique(rows(rawFacts, tags, unit, now).filter(f => f.start === base.start && f.end === base.end && f.accession === base.accession && f.filed === base.filed));
    const instant = (tag: string, end: string, accession: string) => unique(rows(rawFacts, [tag], 'USD', now).filter(f => f.start === null && f.end === end && f.accession === accession && filingMap.get(f.accession)?.filed === f.filed));
    const used = new Map<string, Fact>();
    const use = (f: Fact | undefined) => { if (f)
        used.set([f.tag, f.start, f.end, f.accession].join(':'), f); };
    const metric = (value: number | null, unit: FundamentalMetric['unit'], period: string | null, note: string): FundamentalMetric => ({ value: Number.isFinite(value) ? value : null, unit, period, note });
    const absent = (note: string, unit: FundamentalMetric['unit'] = 'ratio') => metric(null, unit, null, note);
    const metrics: CompanyFundamentals['metrics'] = { pe: absent('Unavailable without a verified current quote and compatible earnings basis'), priceToBook: absent('Unavailable without a verified quote/book value per share'), roe: absent('Requires aligned annual net income and beginning/ending common equity', 'percent'), operatingMargin: absent('Requires matching revenue and operating income contexts', 'percent'), debtToEquity: absent('Requires complete reported debt components and positive equity in one fiscal context'), revenueGrowth: absent('Requires same-tag comparable prior-year revenue in the same filing', 'percent'), dividendYield: absent('Unavailable without actual quote and declared dividend basis', 'percent'), marketCap: absent('Unavailable without actual quote and matching share count', 'currency'), eps: absent('No matching reported diluted EPS', 'currency') };
    if (revenue) {
        use(revenue);
        const operating = context(['OperatingIncomeLoss'], revenue);
        if (operating && revenue.value > 0) {
            use(operating);
            metrics.operatingMargin = metric(operating.value / revenue.value * 100, 'percent', revenue.end, 'Reported period operating income / revenue; not a silently synthesized TTM ratio.');
        }
        const eps = context(['EarningsPerShareDiluted'], revenue, 'USD/shares');
        if (eps) {
            use(eps);
            metrics.eps = metric(eps.value, 'currency', eps.end, 'Reported diluted EPS for the stated fiscal period, not forward EPS.');
        }
        const prior = unique(revenues.filter(f => f.tag === revenue!.tag && f.accession === revenue!.accession && f.filed === revenue!.filed && f.start && days(f.end, revenue!.end) >= 335 && days(f.end, revenue!.end) <= 395 && Math.abs(days(f.start, f.end) - days(revenue!.start!, revenue!.end)) <= 15));
        if (prior && prior.value > 0) {
            use(prior);
            metrics.revenueGrowth = metric((revenue.value / prior.value - 1) * 100, 'percent', revenue.end, 'Same filing, same revenue tag and comparable prior-year duration.');
        }
    }
    // ROE deliberately uses an annual statement and average beginning/ending common equity; quarterly income is never annualized by multiplication.
    const annuals = revenues.filter(f => now.getTime() - Date.parse(f.end) <= 550 * DAY && f.start && days(f.start, f.end) >= 335 && /^10-K/.test(f.form));
    for (const annual of annuals) {
        const income = context(['NetIncomeLoss'], annual), endEquity = instant('StockholdersEquity', annual.end, annual.accession);
        const beginning = rows(rawFacts, ['StockholdersEquity'], 'USD', now).filter(f => !f.start && f.accession === annual.accession && f.filed === annual.filed && annual.start && days(f.end, annual.start) >= 0 && days(f.end, annual.start) <= 1);
        const beginEquity = unique(beginning);
        if (income && endEquity && beginEquity && endEquity.value > 0 && beginEquity.value > 0) {
            use(income);
            use(endEquity);
            use(beginEquity);
            metrics.roe = metric(income.value / ((endEquity.value + beginEquity.value) / 2) * 100, 'percent', annual.end, 'Annual net income / average beginning and ending positive common equity, all from the same filing.');
            break;
        }
    }
    const equities = rows(rawFacts, ['StockholdersEquity'], 'USD', now).filter(f => !f.start && f.value > 0 && now.getTime() - Date.parse(f.end) <= 550 * DAY && filingMap.get(f.accession)?.filed === f.filed).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
    for (const equity of equities) {
        if (!unique(equities.filter(f => f.end === equity.end && f.accession === equity.accession)))
            continue;
        const noncurrent = instant('LongTermDebtNoncurrent', equity.end, equity.accession), aggregateCurrent = instant('DebtCurrent', equity.end, equity.accession), current = instant('LongTermDebtCurrent', equity.end, equity.accession), short = instant('ShortTermBorrowings', equity.end, equity.accession) ?? (symbol === 'AAPL' ? instant('CommercialPaper', equity.end, equity.accession) : undefined);
        const debt = noncurrent && aggregateCurrent ? [noncurrent, aggregateCurrent] : noncurrent && current && short ? [noncurrent, current, short] : null;
        if (debt && debt.every(f => f.value >= 0)) {
            debt.forEach(use);
            use(equity);
            metrics.debtToEquity = metric(debt.reduce((sum, f) => sum + f.value, 0) / equity.value, 'ratio', equity.end, 'Reported noncurrent debt plus complete current debt; excludes leases. No missing borrowing component is inferred zero.');
            break;
        }
    }
    const factEvidence = [...used.values()].map(f => { const sourceUrl = filingMap.get(f.accession)!.url; const excerpt = `Reported SEC XBRL ${f.tag}: ${f.value} ${f.unit}; ${f.start ? f.start + ' to ' : ''}${f.end}; ${f.form} filed ${f.filed}; accession ${f.accession}. Structured fact, not a verbatim filing quotation.`; return { id: 'sec-fact-' + createHash('sha256').update([cik, f.tag, f.start, f.end, f.accession].join(':')).digest('hex').slice(0, 24), ...f, sourceUrl, excerpt }; });
    const observed = Object.values(metrics).some(m => m.value !== null);
    if (!observed)
        warnings.push('No unambiguous comparable numeric metric is available; only issuer/filing metadata may be used.');
    if (!revenue)
        warnings.push('No recent comparable revenue period found; missing or ambiguous facts are not filled.');
    const sourceAsOf = factEvidence.map(f => f.filed).sort().at(-1) ?? null;
    return { status: 'partial', data: { instrument, name: string(sub.name) || string(facts.entityName) || null, sector: null, industry: string(sub.sicDescription) || null, currency: used.size ? 'USD' : null, fiscalDate: revenue?.end ?? null, metrics }, provenance: { provider: 'SEC', fetchedAt: options.fetchedAt ?? now.toISOString(), asOf: sourceAsOf, sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, currency: used.size ? 'USD' : null, timezone: null, adjustment: 'unknown', delay: 'unknown' }, issuer: { cik, symbol: instrument.symbol, name: string(sub.name) || string(facts.entityName) }, factEvidence, filings, warnings };
}
export function createSecFundamentalsClient(options: SecOptions = {}) {
    const clock = options.now ?? (() => new Date());
    let registry: {
        expires: number;
        rows: {
            cik: string;
            symbol: string;
            exchange: string;
        }[];
    } | undefined;
    const cache = new Map<string, {
        expires: number;
        result: SecFundamentalsResult;
    }>(), pending = new Map<string, Promise<SecFundamentalsResult>>();
    const transport = options.fetcher ?? fetch;
    const cooldown = transportCooldown.get(transport) ?? { until: 0 };
    transportCooldown.set(transport, cooldown);
    const failure = (i: InstrumentRef, error: unknown): SecFundamentalsResult => { const e = error instanceof SecError ? error : new SecError('unavailable', 'Official SEC data is currently unavailable.'); return { status: e.status, data: null, issuer: null, factEvidence: [], filings: [], provenance: { provider: 'SEC', fetchedAt: clock().toISOString(), asOf: null, sourceUrl: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', currency: null, timezone: null, adjustment: 'unknown', delay: 'unknown' }, warnings: [e.message], ...(e.retryAfterSeconds ? { retryAfterSeconds: e.retryAfterSeconds } : {}) }; };
    async function fetchFundamentals(i: InstrumentRef): Promise<SecFundamentalsResult> {
        if (i.market !== 'US')
            return { ...failure(i, new SecError('unavailable', 'SEC coverage here is limited to verified US-listed issuer identities.')), status: 'unsupported' };
        const symbol = i.symbol.toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9.\-]{0,39}$/.test(symbol))
            return failure(i, new SecError('invalid_data', 'Invalid SEC lookup symbol.'));
        const key = symbol + ':' + (i.exchange ?? '');
        const prior = cache.get(key);
        if (prior && prior.expires > clock().getTime())
            return { ...structuredClone(prior.result), cached: true };
        if (pending.has(key))
            return structuredClone(await pending.get(key)!);
        const task = (async () => {
            let requests = 0;
            const ua = options.userAgent ?? USER_AGENT;
            if (ua.length > 300 || /[\r\n]/.test(ua) || !ua.includes('https://'))
                throw new SecError('invalid_data', 'SEC access requires a descriptive public application identity.');
            async function json(url: string, maxBytes: number) { if (![REGISTRY].includes(url) && !/^https:\/\/data\.sec\.gov\/(submissions\/CIK\d{10}\.json|api\/xbrl\/companyfacts\/CIK\d{10}\.json)$/.test(url))
                throw new SecError('invalid_data', 'Untrusted SEC endpoint refused.'); if (++requests > (options.maxRequests ?? 3))
                throw new SecError('rate_limited', 'SEC per-observation request budget exhausted.', 60); if (cooldown.until > clock().getTime())
                throw new SecError('rate_limited', 'SEC request cooldown is active.', Math.ceil((cooldown.until - clock().getTime()) / 1000)); return paced(async () => { const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, Math.max(1000, Math.min(options.timeoutMs ?? 15000, 30000))); if (options.signal?.aborted)
                controller.abort(); options.signal?.addEventListener('abort', abort, { once: true }); try {
                const response = await (options.fetcher ?? fetch)(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
                if (!response.ok) {
                    await response.body?.cancel();
                    if (response.status === 429 || response.status === 403) {
                        const seconds = Math.max(60, Math.min(Number(response.headers.get('retry-after')) || 300, 86400));
                        cooldown.until = clock().getTime() + seconds * 1000;
                        throw new SecError(response.status === 429 ? 'rate_limited' : 'unavailable', 'SEC access was limited. No retry or bypass was attempted.', seconds);
                    }
                    throw new SecError('unavailable', 'SEC source is unavailable for this issuer.');
                }
                const reader = response.body?.getReader();
                if (!reader)
                    throw new SecError('invalid_data', 'SEC source body is missing.');
                const chunks: Uint8Array[] = [];
                let total = 0;
                try {
                    for (;;) {
                        const next = await reader.read();
                        if (next.done)
                            break;
                        total += next.value.length;
                        if (total > maxBytes) {
                            await reader.cancel();
                            throw new SecError('invalid_data', 'SEC response exceeded its bounded size limit.');
                        }
                        chunks.push(next.value);
                    }
                }
                finally {
                    reader.releaseLock();
                }
                const bytes = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.length;
                }
                return JSON.parse(new TextDecoder().decode(bytes));
            }
            finally {
                clearTimeout(timer);
                options.signal?.removeEventListener('abort', abort);
            } }); }
            try {
                const seed = verifiedUsIdentities[symbol as keyof typeof verifiedUsIdentities];
                let cik: string | undefined = seed?.cik;
                if (!cik) {
                    if (!registry || registry.expires < clock().getTime()) {
                        const raw = object(await json(REGISTRY, 2000000));
                        if (!Array.isArray(raw.fields) || !Array.isArray(raw.data))
                            throw new SecError('invalid_data', 'SEC issuer discovery schema changed.');
                        const fields = raw.fields as string[], ci = fields.indexOf('cik'), ti = fields.indexOf('ticker'), ex = fields.indexOf('exchange');
                        if (ci < 0 || ti < 0)
                            throw new SecError('invalid_data', 'SEC issuer discovery lacks identity fields.');
                        registry = { expires: clock().getTime() + DAY, rows: raw.data.filter(Array.isArray).map(r => ({ cik: String(r[ci]).padStart(10, '0'), symbol: string(r[ti]).toUpperCase(), exchange: ex >= 0 ? string(r[ex]) : '' })) };
                    }
                    const found = registry.rows.filter(r => r.symbol === symbol);
                    if (found.length !== 1)
                        throw new SecError('invalid_data', 'SEC symbol mapping is missing or ambiguous. No guessed CIK was used.');
                    cik = found[0].cik;
                }
                const submissions = await json(`https://data.sec.gov/submissions/CIK${cik}.json`, 2000000), facts = await json(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, 12000000);
                const result = normalizeSecFundamentals(i, cik, facts, submissions, { now: clock(), fetchedAt: clock().toISOString() });
                result.dataMode = 'fresh_sec_fetch';
                cache.set(key, { expires: clock().getTime() + 900000, result });
                while (cache.size > 32)
                    cache.delete(cache.keys().next().value!);
                return structuredClone(result);
            }
            catch (error) {
                return failure(i, error);
            }
        })().catch(error => failure(i, error));
        pending.set(key, task);
        try {
            return await task;
        }
        finally {
            pending.delete(key);
        }
    }
    return { fetchFundamentals };
}
/** Approved, normalized public filing facts only. No quotes, market prices or vendor datasets are bundled. */
export function getCachedSecFundamentals(instrument: InstrumentRef): SecFundamentalsResult | null {
    if (instrument.market !== 'US')
        return null;
    const symbol = instrument.symbol.toUpperCase();
    const source = symbol === 'AAPL' ? aaplSnapshot : symbol === 'MSFT' ? msftSnapshot : null;
    if (!source)
        return null;
    const result = structuredClone(source) as unknown as SecFundamentalsResult;
    const seed = verifiedUsIdentities[symbol as keyof typeof verifiedUsIdentities];
    if (!seed || result.issuer?.cik !== seed.cik || result.issuer.symbol !== symbol || result.provenance.provider !== 'SEC' || result.dataMode !== 'cached_snapshot')
        throw new Error('Cached SEC identity/provenance is invalid.');
    if (result.data)
        result.data.instrument = { ...instrument };
    return result;
}
/** Reuses the exact recorded refresh failure; it never manufactures a new successful network observation. */
export function applySecSnapshotFallback(instrument: InstrumentRef, refresh: SecFundamentalsResult): SecFundamentalsResult {
    if (!['unavailable', 'rate_limited'].includes(refresh.status))
        return refresh;
    const snapshot = getCachedSecFundamentals(instrument);
    if (!snapshot)
        return refresh;
    snapshot.snapshot!.refresh = { status: refresh.status, attemptedAt: refresh.provenance.fetchedAt, warnings: [...refresh.warnings] };
    snapshot.warnings = ['Fresh SEC refresh is unavailable; using a visibly dated cached snapshot.', ...snapshot.warnings, ...refresh.warnings];
    return snapshot;
}
const defaultClient = createSecFundamentalsClient();
export async function fetchSecFundamentals(instrument: InstrumentRef, options?: SecOptions): Promise<SecFundamentalsResult> { const fresh = await (options ? createSecFundamentalsClient(options) : defaultClient).fetchFundamentals(instrument); return applySecSnapshotFallback(instrument, fresh); }
