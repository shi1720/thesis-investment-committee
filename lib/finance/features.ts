import type { FactorInput, FactorScore } from './contracts';
import { instrumentKey } from './contracts';
/** Cross-sectional percentile ranks, average ties. Rank stability avoids unbounded influence from ratio outliers. */
export function percentileRank(value: number, peers: number[]): number | null { const clean = peers.filter(Number.isFinite); if (!Number.isFinite(value) || clean.length < 2)
    return null; const less = clean.filter(v => v < value).length, equal = clean.filter(v => v === value).length; return Math.max(0, Math.min(100, 100 * (less + (equal - 1) / 2) / (clean.length - 1))); }
export function scoreFactors(inputs: FactorInput[], options: {
    minPeers?: number;
    now?: Date;
    maxHistoryAgeDays?: number;
} = {}): FactorScore[] {
    if (new Set(inputs.map(i => instrumentKey(i.instrument))).size !== inputs.length)
        throw new Error('Factor cohort contains duplicate instruments.');
    const minPeers = Math.max(3, options.minPeers ?? 5), now = (options.now ?? new Date()).getTime();
    const rows = inputs.map(i => { const period = i.fundamentals?.fiscalDate; const fundamentalFresh = period && Number.isFinite(Date.parse(period)) && Date.parse(period) <= now + 86400000 && now - Date.parse(period) <= 550 * 86400000; const m = fundamentalFresh ? i.fundamentals?.metrics : undefined; const fresh = i.history?.lastDate && Number.isFinite(Date.parse(i.history.lastDate)) && now - Date.parse(i.history.lastDate) <= (options.maxHistoryAgeDays ?? 14) * 86400000 && Date.parse(i.history.lastDate) <= now + 86400000; const val = [m?.pe.value, m?.priceToBook.value].map(v => v !== null && v !== undefined && v > 0 ? 1 / v : null); const quality = [m?.roe.value ?? null, m?.operatingMargin.value ?? null, m?.debtToEquity.value !== null && m?.debtToEquity.value !== undefined && m.debtToEquity.value >= 0 ? -m.debtToEquity.value : null]; return { input: i, val, quality, momentum: fresh ? i.history?.momentum12minus1 ?? null : null, lowvol: fresh && i.history?.annualizedVolatility !== null && i.history?.annualizedVolatility !== undefined ? -i.history.annualizedVolatility : null }; });
    const rank = (value: number | null, values: (number | null)[]) => value === null || !Number.isFinite(value) || values.filter(v => v !== null && Number.isFinite(v)).length < minPeers ? null : percentileRank(value, values.filter((v): v is number => v !== null));
    return rows.map(row => {
        const combine = (values: (number | null)[], all: (number | null)[][], required: number) => { const ranks = values.map((v, j) => rank(v, all.map(a => a[j]))); const known = ranks.filter((r): r is number => r !== null); return { score: known.length >= required ? known.reduce((a, b) => a + b, 0) / known.length : null, coverage: known.length / values.length }; };
        const value = combine(row.val, rows.map(r => r.val), 1), quality = combine(row.quality, rows.map(r => r.quality), 2);
        const momentum = rank(row.momentum, rows.map(r => r.momentum)), low = rank(row.lowvol, rows.map(r => r.lowvol));
        const components: FactorScore['components'] = [{ name: 'value', ...value, detail: 'Equal-weight available positive earnings yield and book yield percentile ranks.' }, { name: 'quality', ...quality, detail: 'ROE, operating margin and inverse leverage percentile ranks; at least two descriptors required. Earnings stability is unavailable, not inferred.' }, { name: 'momentum', score: momentum, coverage: momentum === null ? 0 : 1, detail: 'P(t−21)/P(t−252)−1 using observed split-adjusted daily sessions; latest month excluded.' }, { name: 'low_volatility', score: low, coverage: low === null ? 0 : 1, detail: 'Inverse annualized sample standard deviation of daily simple returns, 252-session convention.' }];
        const known = components.filter(c => c.score !== null), coverage = components.reduce((s, c) => s + c.coverage, 0) / 4;
        const score = known.length === 4 ? known.reduce((s, c) => s + c.score!, 0) / 4 : null;
        return { instrument: row.input.instrument, score, components, coverage, peerCount: rows.length, warnings: ['Research-cohort percentile heuristic, not a fund replica, expected return or probability. Sector, accounting and country differences can confound ranks.', 'Fundamental descriptors keep their reported periods; an undated metric is not a current filing verification.', ...(score === null ? ['Composite withheld: every factor needs sufficient comparable observed data and peers.'] : []), ...(rows.length < minPeers ? [`At least ${minPeers} securities with valid descriptor values are needed for peer ranks.`] : [])] };
    });
}
