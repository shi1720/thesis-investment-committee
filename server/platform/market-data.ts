import { createHash } from 'node:crypto';
import type { Market } from '../../lib/contracts';
import type { Adjustment, CompanyFundamentals, CompanyNews, DataProvenance, DataStatus, FundamentalMetric, InstrumentRef, MarketHistory, MarketProvider, MarketQuote, PriceBar, ProviderResult } from '../../lib/finance/contracts';
import { instrumentSchema } from '../../lib/finance/contracts';
import { analyzeHistory } from '../../lib/finance/math';
import { defaultMarketCache, MarketDataCache } from './market-cache';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const text = (v: unknown) => typeof v === 'string' ? v : '';
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v) && Number.isFinite(Number(v)) ? Number(v) : null;
const date = (v: unknown): string | null => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
const epoch = (v: unknown): string | null => { const n = num(v); return n !== null && n > 0 && n < 1e11 ? new Date(n * 1000).toISOString() : null; };
const currency = (v: unknown): string | null => typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : null;
const region = (v: unknown): Market | null => ({ 'united states': 'US', 'united states of america': 'US', 'us': 'US', 'india': 'India', 'china': 'China', 'hong kong': 'China', 'united arab emirates': 'UAE', 'uae': 'UAE' } as Record<string, Market>)[text(v).toLowerCase()] ?? null;
const safeUrl = (v: unknown): string | null => { try {
    const u = new URL(text(v));
    return u.protocol === 'https:' ? u.toString() : null;
}
catch {
    return null;
} };
class DataFailure extends Error {
    constructor(readonly status: DataStatus, message: string, readonly retryAfterSeconds?: number) { super(message); }
}
export interface MarketClientOptions {
    provider: MarketProvider;
    apiKey: string;
    userId: string;
    cache?: MarketDataCache;
    fetcher?: typeof fetch;
    now?: () => Date;
    maxRequestsPerMinute?: number;
    maxRequestsPerDay?: number;
    premiumHistory?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal; /** Optional durable quota reservation supplied by the owning route. */
    reserveQuota?: (credits: number) => Promise<{
        allowed: boolean;
        retryAfterSeconds?: number;
    }>;
}
const BASE: Record<MarketProvider, string> = { finnhub: 'https://finnhub.io/api/v1', twelvedata: 'https://api.twelvedata.com', alphavantage: 'https://www.alphavantage.co/query' };
const LIMITS: Record<MarketProvider, {
    minute: number;
    day: number;
}> = { finnhub: { minute: 50, day: 5000 }, twelvedata: { minute: 8, day: 800 }, alphavantage: { minute: 5, day: 25 } };
export class MarketDataClient {
    private cache: MarketDataCache;
    private credentialId: string;
    private userScope: string;
    constructor(private options: MarketClientOptions) { this.cache = options.cache ?? defaultMarketCache; this.credentialId = createHash('sha256').update(options.provider + '\0' + options.apiKey).digest('hex'); this.userScope = createHash('sha256').update(options.userId).digest('hex'); if (!options.userId)
        throw new Error('Authenticated market-data owner is required.'); }
    private now() { return this.options.now?.() ?? new Date(); }
    private provenance(endpoint: string, instrument?: InstrumentRef): DataProvenance { return { provider: this.options.provider, fetchedAt: this.now().toISOString(), asOf: null, sourceUrl: BASE[this.options.provider] + (this.options.provider === 'alphavantage' ? '?function=' + endpoint : endpoint), currency: instrument?.currency ?? null, timezone: null, adjustment: 'unknown', delay: 'unknown' }; }
    private async request(endpoint: string, params: Record<string, string>, credits = 1): Promise<unknown> {
        if (!this.options.apiKey || this.options.apiKey === 'demo')
            throw new DataFailure('unauthorized', 'Configure your own provider key. Public demonstration keys are not a production data fallback.');
        const limits = LIMITS[this.options.provider];
        const quota = this.cache.reserve(this.credentialId, { minute: this.options.maxRequestsPerMinute ?? limits.minute, day: this.options.maxRequestsPerDay ?? limits.day }, credits);
        if (!quota.allowed)
            throw new DataFailure('rate_limited', 'Configured provider request budget exhausted. Cached data remains available until its TTL.', quota.retryAfterSeconds);
        if (this.options.reserveQuota) {
            const q = await this.options.reserveQuota(credits);
            if (!q.allowed)
                throw new DataFailure('rate_limited', 'Account provider budget exhausted.', q.retryAfterSeconds ?? 60);
        }
        const provider = this.options.provider, url = new URL(BASE[provider] + (provider === 'alphavantage' ? '' : endpoint));
        for (const [k, v] of Object.entries(params))
            url.searchParams.set(k, v);
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (provider === 'alphavantage') {
            url.searchParams.set('function', endpoint);
            url.searchParams.set('apikey', this.options.apiKey);
        }
        else if (provider === 'finnhub')
            headers['X-Finnhub-Token'] = this.options.apiKey;
        else
            headers.Authorization = 'apikey ' + this.options.apiKey;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(this.options.timeoutMs ?? 12000, 30000)));
        const abort = () => controller.abort();
        if (this.options.signal?.aborted)
            controller.abort();
        this.options.signal?.addEventListener('abort', abort, { once: true });
        try {
            const response = await (this.options.fetcher ?? fetch)(url, { headers, signal: controller.signal, redirect: 'error' });
            let retry = Number(response.headers.get('retry-after'));
            if (!Number.isFinite(retry) || retry < 1) {
                const until = Date.parse(response.headers.get('retry-after') ?? '');
                retry = Number.isFinite(until) ? Math.max(1, Math.ceil((until - this.now().getTime()) / 1000)) : 60;
            }
            retry = Math.min(retry, 86400);
            if (!response.ok) {
                try {
                    await response.body?.cancel();
                }
                catch { }
            }
            if (response.status === 429) {
                this.cache.block(this.credentialId, retry);
                throw new DataFailure('rate_limited', 'Provider rate limit reached. No automatic retry was sent.', retry);
            }
            if (response.status === 401)
                throw new DataFailure('unauthorized', 'Provider rejected the configured API key.');
            if (response.status === 403)
                throw new DataFailure('unsupported', 'The API key is not entitled to this endpoint or exchange.');
            if (!response.ok)
                throw new DataFailure('unavailable', 'Market provider is currently unavailable.');
            if (Number(response.headers.get('content-length')) > 2000000) {
                await response.body?.cancel();
                throw new DataFailure('invalid_data', 'Provider response exceeded its size limit.');
            }
            const reader = response.body?.getReader();
            if (!reader)
                throw new DataFailure('invalid_data', 'Provider returned no response body.');
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
                while (true) {
                    const v = await reader.read();
                    if (v.done)
                        break;
                    bytes += v.value.length;
                    if (bytes > 2000000) {
                        await reader.cancel();
                        throw new DataFailure('invalid_data', 'Provider response exceeded its size limit.');
                    }
                    chunks.push(v.value);
                }
            }
            finally {
                reader.releaseLock();
            }
            const all = new Uint8Array(bytes);
            let offset = 0;
            for (const c of chunks) {
                all.set(c, offset);
                offset += c.length;
            }
            let value: unknown;
            try {
                value = JSON.parse(new TextDecoder().decode(all));
            }
            catch {
                throw new DataFailure('invalid_data', 'Provider returned invalid JSON.');
            }
            const envelope = obj(value);
            const message = [envelope.Note, envelope.Information, envelope['Error Message'], envelope.error, envelope.message].filter(v => typeof v === 'string').join(' ');
            if (envelope.status === 'error' || envelope['Error Message'] || envelope.Note || envelope.Information || envelope.error) {
                if (/limit|frequency|credit|requests per|rate/i.test(message)) {
                    this.cache.block(this.credentialId, 60);
                    throw new DataFailure('rate_limited', 'Provider quota exceeded. No automatic retry was sent.', 60);
                }
                if (/premium|subscribe|subscription|plan|permission|access/i.test(message))
                    throw new DataFailure('unsupported', 'This endpoint or exchange requires different provider entitlements.');
                if (/key|token|auth/i.test(message))
                    throw new DataFailure('unauthorized', 'Provider rejected the configured API key.');
                throw new DataFailure('unavailable', 'Provider returned no usable data.');
            }
            return value;
        }
        catch (e) {
            if (e instanceof DataFailure)
                throw e;
            throw new DataFailure('unavailable', controller.signal.aborted ? 'Provider request cancelled or timed out.' : 'Provider request failed.');
        }
        finally {
            clearTimeout(timeout);
            this.options.signal?.removeEventListener('abort', abort);
        }
    }
    private async run<T>(kind: string, ttl: number, endpoint: string, instrument: InstrumentRef | undefined, work: (p: DataProvenance) => Promise<{
        data: T;
        warnings?: string[];
        status?: 'ok' | 'partial';
    }>): Promise<ProviderResult<T>> {
        const identity = instrument ? JSON.stringify(instrument) : '';
        const key = [this.userScope, this.credentialId, kind, identity].join(':');
        try {
            const loaded = await this.cache.load(key, ttl, async () => { const p = this.provenance(endpoint, instrument); try {
                const result = await work(p);
                return { status: result.status ?? 'ok', data: result.data, provenance: p, warnings: result.warnings ?? [] } as ProviderResult<T>;
            }
            catch (e) {
                const f = e instanceof DataFailure ? e : new DataFailure('invalid_data', 'Provider data did not satisfy the financial contract.');
                return { status: f.status, data: null, provenance: p, warnings: [f.message], ...(f.retryAfterSeconds ? { retryAfterSeconds: f.retryAfterSeconds } : {}) } as ProviderResult<T>;
            } }, v => v.status === 'ok' || v.status === 'partial');
            return { ...loaded.value, cached: loaded.cached };
        }
        catch {
            return { status: 'unavailable', data: null, provenance: this.provenance(endpoint, instrument), warnings: ['Market data concurrency limit reached.'] };
        }
    }
    async search(query: string, market?: Market): Promise<ProviderResult<InstrumentRef[]>> {
        query = query.trim();
        if (!query || query.length > 100)
            return { status: 'invalid_data', data: null, provenance: this.provenance('search'), warnings: ['Search must contain one to one hundred characters.'] };
        const provider = this.options.provider, endpoint = provider === 'finnhub' ? '/search' : provider === 'twelvedata' ? '/symbol_search' : 'SYMBOL_SEARCH';
        return this.run('search:' + query + ':' + (market ?? 'all'), 86400000, endpoint, undefined, async (p) => {
            const out = obj(await this.request(endpoint, provider === 'finnhub' ? { q: query } : provider === 'twelvedata' ? { symbol: query, outputsize: '30' } : { keywords: query }));
            const raw = provider === 'finnhub' ? out.result : provider === 'twelvedata' ? out.data : out.bestMatches;
            if (!Array.isArray(raw))
                throw new DataFailure('invalid_data', 'Provider search returned no symbol list.');
            const results: InstrumentRef[] = [];
            for (const v of raw.slice(0, 60)) {
                const r = obj(v);
                const known = region(r.country ?? r['4. region']);
                const symbol = text(r.symbol ?? r['1. symbol']);
                const inferred = provider === 'finnhub' && !symbol.includes('.') ? 'US' : known;
                if (!symbol || !inferred || (market && inferred !== market))
                    continue;
                results.push({ symbol, providerSymbol: symbol, market: inferred, name: text(r.instrument_name ?? r.description ?? r['2. name']) || undefined, exchange: text(r.exchange) || undefined, currency: currency(r.currency ?? r['8. currency']) ?? undefined });
            }
            p.asOf = null;
            return { data: results, warnings: ['Provider symbol metadata is discovery, not proof that your subscription covers quotes/history for the listing.', ...(provider === 'finnhub' ? ['Unclassified foreign search results are omitted; use an exact provider-qualified symbol and verified listing metadata.'] : [])] };
        });
    }
    async quote(input: InstrumentRef): Promise<ProviderResult<MarketQuote>> { const i = instrumentSchema.parse(input), provider = this.options.provider, endpoint = provider === 'finnhub' ? '/quote' : provider === 'twelvedata' ? '/quote' : 'GLOBAL_QUOTE'; return this.run('quote', 60000, endpoint, i, async (p) => { const raw = obj(await this.request(endpoint, { symbol: i.providerSymbol ?? i.symbol, ...(provider === 'twelvedata' && i.exchange ? { exchange: i.exchange } : {}) })); const r = provider === 'alphavantage' ? obj(raw['Global Quote']) : raw; const returnedSymbol = text(r.symbol ?? r['01. symbol']); if (returnedSymbol && returnedSymbol.toUpperCase() !== (i.providerSymbol ?? i.symbol).toUpperCase())
        throw new DataFailure('invalid_data', 'Provider returned a different quote symbol.'); if (currency(r.currency) && i.currency && currency(r.currency) !== i.currency)
        throw new DataFailure('invalid_data', 'Provider quote currency disagrees with instrument metadata.'); const price = num(provider === 'finnhub' ? r.c : provider === 'alphavantage' ? r['05. price'] : r.close); const asOf = provider === 'finnhub' ? epoch(r.t) : provider === 'alphavantage' ? date(r['07. latest trading day']) : epoch(r.timestamp) ?? date(r.datetime); if (price === null || price <= 0 || !asOf || Date.parse(asOf) > this.now().getTime() + 86400000)
        throw new DataFailure('invalid_data', 'Provider quote has no positive dated price.'); const c = currency(r.currency) ?? i.currency ?? null; p.asOf = asOf; p.currency = c; p.timezone = text(r.exchange_timezone) || null; p.adjustment = 'raw'; p.delay = provider === 'alphavantage' ? 'end_of_day' : 'unknown'; const previous = num(provider === 'finnhub' ? r.pc : provider === 'alphavantage' ? r['08. previous close'] : r.previous_close); const change = previous !== null && previous > 0 ? price - previous : null; const stale = this.now().getTime() - Date.parse(asOf) > 7 * 86400000; return { data: { instrument: i, price, previousClose: previous, change, changePercent: change !== null && previous ? change / previous * 100 : null, asOf, currency: c }, status: stale || !c ? 'partial' : 'ok', warnings: [...(stale ? ['Quote is older than seven days; do not present it as current.'] : []), ...(!currency(r.currency) ? ['Quote currency is supplied by verified instrument metadata, or remains unknown; provider quote omitted it.'] : []), 'Exchange delay/entitlements vary by plan; unknown delay is not asserted real-time.'] }; }); }
    async history(input: InstrumentRef, options: {
        limit?: number;
        adjustment?: Adjustment;
    } = {}): Promise<ProviderResult<MarketHistory>> {
        const i = instrumentSchema.parse(input), provider = this.options.provider, limit = Math.max(2, Math.min(Math.floor(options.limit ?? 400), 600));
        const adjustment = options.adjustment ?? (provider === 'twelvedata' ? 'split_adjusted' : provider === 'alphavantage' && this.options.premiumHistory ? 'split_dividend_adjusted' : 'unknown');
        const endpoint = provider === 'finnhub' ? '/stock/candle' : provider === 'twelvedata' ? '/time_series' : adjustment === 'split_dividend_adjusted' ? 'TIME_SERIES_DAILY_ADJUSTED' : 'TIME_SERIES_DAILY';
        return this.run('history:' + limit + ':' + adjustment, 21600000, endpoint, i, async (p) => {
            let bars: PriceBar[] = [];
            let c = i.currency ?? null, tz: string | null = null, actual: Adjustment = adjustment;
            let warnings: string[] = [];
            if (provider === 'twelvedata') {
                const out = obj(await this.request(endpoint, { symbol: i.providerSymbol ?? i.symbol, interval: '1day', outputsize: String(limit), order: 'asc', adjust: adjustment === 'split_dividend_adjusted' ? 'all' : adjustment === 'raw' ? 'none' : 'splits', ...(i.exchange ? { exchange: i.exchange } : {}) }));
                const meta = obj(out.meta);
                if (text(meta.symbol) && text(meta.symbol).toUpperCase() !== (i.providerSymbol ?? i.symbol).toUpperCase())
                    throw new DataFailure('invalid_data', 'Provider returned a different history symbol.');
                if (currency(meta.currency) && i.currency && currency(meta.currency) !== i.currency)
                    throw new DataFailure('invalid_data', 'History currency disagrees with instrument metadata.');
                c = currency(meta.currency) ?? c;
                tz = text(meta.exchange_timezone) || null;
                if (!Array.isArray(out.values))
                    throw new DataFailure('invalid_data', 'Provider history has no daily bars.');
                bars = out.values.map(v => { const r = obj(v); return { date: text(r.datetime), open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close) ?? NaN, volume: num(r.volume) }; });
                actual = adjustment === 'raw' ? 'raw' : adjustment === 'split_dividend_adjusted' ? 'split_dividend_adjusted' : 'split_adjusted';
            }
            else if (provider === 'alphavantage') {
                if (adjustment === 'split_adjusted')
                    throw new DataFailure('unsupported', 'Alpha Vantage daily endpoint offers raw or split-and-dividend-adjusted close; split-only is not silently substituted.');
                const full = !!this.options.premiumHistory;
                const out = obj(await this.request(endpoint, { symbol: i.providerSymbol ?? i.symbol, outputsize: full ? 'full' : 'compact' }));
                const meta = obj(out['Meta Data']);
                tz = text(meta['5. Time Zone']) || null;
                const series = obj(out['Time Series (Daily)']);
                bars = Object.entries(series).map(([d, v]) => { const r = obj(v); return { date: d, open: adjustment === 'split_dividend_adjusted' ? null : num(r['1. open']), high: adjustment === 'split_dividend_adjusted' ? null : num(r['2. high']), low: adjustment === 'split_dividend_adjusted' ? null : num(r['3. low']), close: num(r[adjustment === 'split_dividend_adjusted' ? '5. adjusted close' : '4. close']) ?? NaN, volume: num(r['6. volume'] ?? r['5. volume']) }; }).sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
                actual = adjustment === 'split_dividend_adjusted' ? 'split_dividend_adjusted' : 'raw';
                if (adjustment === 'split_dividend_adjusted')
                    warnings.push('Only adjusted close is available; unadjusted OHLC values are omitted.');
                if (!full)
                    warnings.push('Free compact daily history is limited to100 observations. Twelve-minus-one-month momentum is unavailable.');
            }
            else {
                const to = Math.floor(this.now().getTime() / 1000), from = to - Math.ceil(limit * 1.8) * 86400;
                const out = obj(await this.request(endpoint, { symbol: i.providerSymbol ?? i.symbol, resolution: 'D', from: String(from), to: String(to) }));
                if (out.s === 'no_data')
                    throw new DataFailure('unavailable', 'Provider returned no daily history for this listing.');
                if (out.s !== 'ok' || !Array.isArray(out.t) || !Array.isArray(out.c) || out.t.length !== out.c.length)
                    throw new DataFailure('invalid_data', 'Provider candle arrays do not align.');
                const times = out.t as unknown[], closes = out.c as unknown[];
                bars = times.map((t, j) => ({ date: epoch(t)?.slice(0, 10) ?? '', open: num(Array.isArray(out.o) ? out.o[j] : null), high: num(Array.isArray(out.h) ? out.h[j] : null), low: num(Array.isArray(out.l) ? out.l[j] : null), close: num(closes[j]) ?? NaN, volume: num(Array.isArray(out.v) ? out.v[j] : null) })).slice(-limit);
                actual = 'unknown';
                warnings.push('Provider candle adjustment convention is not attested here; factor/risk metrics require a verified adjusted series. History may require a paid plan.');
            }
            if (!bars.length)
                throw new DataFailure('unavailable', 'No history observations were returned.');
            bars.sort((a, b) => a.date.localeCompare(b.date));
            const last = bars[bars.length - 1].date;
            if (Date.parse(last) > this.now().getTime() + 86400000)
                throw new DataFailure('invalid_data', 'History contains a future price date.');
            const history: MarketHistory = { instrument: i, bars, interval: '1day', currency: c, timezone: tz, adjustment: actual };
            analyzeHistory(history);
            p.asOf = last;
            p.currency = c;
            p.timezone = tz;
            p.adjustment = actual;
            p.delay = 'end_of_day';
            if (!c)
                warnings.push('Listing currency is unknown; base-currency analytics are unavailable.');
            if (!tz)
                warnings.push('Provider omitted exchange timezone; daily dates are preserved as supplied, not shifted to UTC sessions.');
            if (this.now().getTime() - Date.parse(last) > 14 * 86400000)
                warnings.push('History is stale; source date is preserved.');
            return { data: history, status: warnings.length ? 'partial' : 'ok', warnings };
        });
    }
    async fundamentals(input: InstrumentRef): Promise<ProviderResult<CompanyFundamentals>> {
        const i = instrumentSchema.parse(input), provider = this.options.provider, endpoint = provider === 'finnhub' ? '/stock/metric' : provider === 'twelvedata' ? '/statistics' : 'OVERVIEW';
        return this.run('fundamentals', 86400000, endpoint, i, async (p) => {
            const out = obj(await this.request(endpoint, { symbol: i.providerSymbol ?? i.symbol, ...(provider === 'finnhub' ? { metric: 'all' } : {}) }, provider === 'twelvedata' ? 50 : 1));
            const meta = obj(out.meta), stats = obj(out.statistics), financials = obj(stats.financials), valuation = obj(stats.valuations_metrics), income = obj(financials.income_statement), dividends = obj(stats.dividends_and_splits), flat = obj(out.metric);
            if (Object.keys(out).length === 0)
                throw new DataFailure('unavailable', 'No company fundamentals returned.');
            const period = provider === 'alphavantage' ? date(out.LatestQuarter) : provider === 'twelvedata' ? date(financials.most_recent_quarter) : null;
            if (period && Date.parse(period) > this.now().getTime() + 86400000)
                throw new DataFailure('invalid_data', 'Fundamental fiscal period is in the future.');
            const c = currency(out.Currency ?? meta.currency) ?? i.currency ?? null;
            const metric = (value: unknown, unit: FundamentalMetric['unit'], note: string, multiple = 1): FundamentalMetric => ({ value: num(value) === null ? null : num(value)! * multiple, unit, period, note });
            const missing = (note: string) => metric(null, 'ratio', note);
            const metrics: CompanyFundamentals['metrics'] = provider === 'alphavantage' ? { pe: metric(out.PERatio, 'ratio', 'Provider trailing P/E'), priceToBook: metric(out.PriceToBookRatio, 'ratio', 'Provider price/book'), roe: metric(out.ReturnOnEquityTTM, 'percent', 'Provider TTM ROE converted from decimal', 100), operatingMargin: metric(out.OperatingMarginTTM, 'percent', 'Provider TTM margin converted from decimal', 100), debtToEquity: missing('Not supplied by OVERVIEW; never inferred zero'), revenueGrowth: metric(out.QuarterlyRevenueGrowthYOY, 'percent', 'Quarterly year-on-year growth converted from decimal', 100), dividendYield: metric(out.DividendYield, 'percent', 'Provider decimal yield converted to percent', 100), marketCap: metric(out.MarketCapitalization, 'currency', 'Provider capitalization in source currency'), eps: metric(out.EPS, 'currency', 'Provider EPS') } : provider === 'twelvedata' ? { pe: metric(valuation.trailing_pe, 'ratio', 'Provider trailing P/E'), priceToBook: metric(valuation.price_to_book_mrq, 'ratio', 'Provider price/book MRQ'), roe: metric(financials.return_on_equity_ttm, 'percent', 'Provider decimal ROE converted to percent', 100), operatingMargin: metric(financials.operating_margin, 'percent', 'Provider decimal margin converted to percent', 100), debtToEquity: missing('Provider leverage scale is not verified; omitted instead of guessing ratio vs percent'), revenueGrowth: metric(income.quarterly_revenue_growth, 'percent', 'Provider decimal quarterly growth converted to percent', 100), dividendYield: metric(dividends.trailing_annual_dividend_yield, 'percent', 'Provider decimal trailing yield converted to percent', 100), marketCap: metric(valuation.market_capitalization, 'currency', 'Provider capitalization'), eps: metric(income.diluted_eps_ttm, 'currency', 'Provider diluted TTM EPS') } : { pe: metric(flat.peTTM, 'ratio', 'Provider TTM P/E'), priceToBook: metric(flat.pbQuarterly, 'ratio', 'Provider quarterly price/book'), roe: metric(flat.roeTTM, 'percent', 'Provider TTM percent ROE'), operatingMargin: metric(flat.operatingMarginTTM, 'percent', 'Provider TTM percent operating margin'), debtToEquity: missing('Leverage unit/period not independently verified'), revenueGrowth: metric(flat.revenueGrowthTTMYoy, 'percent', 'Provider TTM year-on-year percent growth'), dividendYield: metric(flat.dividendYieldIndicatedAnnual, 'percent', 'Provider indicated annual percent yield'), marketCap: metric(flat.marketCapitalization, 'currency_millions', 'Provider market capitalization in millions'), eps: metric(flat.epsTTM, 'currency', 'Provider TTM EPS') };
            if (Object.values(metrics).every(m => m.value === null))
                throw new DataFailure('unavailable', 'Provider returned no recognized fundamental metrics.');
            p.currency = c;
            p.asOf = period;
            p.timezone = text(meta.exchange_timezone) || null;
            return { data: { instrument: i, name: text(out.Name ?? meta.name) || i.name || null, sector: text(out.Sector) || null, industry: text(out.Industry) || null, currency: c, fiscalDate: period, metrics }, status: 'partial', warnings: ['Provider-normalized fundamentals are not independently verified filing facts.', 'As-of is the reported fiscal period when supplied, not a publication timestamp. Undated metrics remain explicitly undated.', 'Fundamental fields and statistics endpoint credits depend on the provider plan; no missing ratio is replaced with zero.'] };
        });
    }
    async news(input: InstrumentRef, options: {
        days?: number;
        limit?: number;
    } = {}): Promise<ProviderResult<CompanyNews[]>> { const i = instrumentSchema.parse(input), provider = this.options.provider, days = Math.max(1, Math.min(options.days ?? 14, 30)), limit = Math.max(1, Math.min(options.limit ?? 10, 20)), endpoint = provider === 'finnhub' ? '/company-news' : provider === 'alphavantage' ? 'NEWS_SENTIMENT' : '/news'; return this.run('news:' + days + ':' + limit, 900000, endpoint, i, async (p) => { if (provider === 'twelvedata')
        throw new DataFailure('unsupported', 'This adapter has no verified Twelve Data company-news contract. Choose Finnhub US company news or Alpha Vantage news with appropriate entitlements.'); if (provider === 'finnhub' && i.market !== 'US')
        throw new DataFailure('unsupported', 'Finnhub company-news is documented for North American companies; foreign coverage is not assumed.'); const from = new Date(this.now().getTime() - days * 86400000).toISOString().slice(0, 10); const raw = await this.request(endpoint, provider === 'finnhub' ? { symbol: i.providerSymbol ?? i.symbol, from, to: this.now().toISOString().slice(0, 10) } : { tickers: i.providerSymbol ?? i.symbol, limit: String(limit), sort: 'LATEST' }); const rows = provider === 'finnhub' ? raw : obj(raw).feed; if (!Array.isArray(rows))
        throw new DataFailure('invalid_data', 'Provider returned no news list.'); const news: CompanyNews[] = []; let rejected = 0; for (const v of rows.slice(0, 100)) {
        const r = obj(v);
        const url = safeUrl(r.url), title = text(r.headline ?? r.title), stamp = provider === 'finnhub' ? epoch(r.datetime) : text(r.time_published).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z');
        if (!url || !title || !stamp || !date(stamp) || Date.parse(stamp) > this.now().getTime() + 86400000) {
            rejected++;
            continue;
        }
        if (Date.parse(stamp) < Date.parse(from))
            continue;
        news.push({ id: createHash('sha256').update(url).digest('hex').slice(0, 24), headline: title.slice(0, 400), summary: text(r.summary).slice(0, 1200), url, source: text(r.source) || provider, publishedAt: stamp!, instrument: i });
    } news.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)); const unique = [...new Map(news.map(n => [n.url, n])).values()].slice(0, limit); p.asOf = unique[0]?.publishedAt ?? null; return { data: unique, status: rejected ? 'partial' : 'ok', warnings: [...(rejected ? ['Malformed or future-dated news entries were omitted.'] : []), 'Headlines and summaries are provider-supplied context, not independently verified events or return predictions.'] }; }); }
}
