import type { MarketHistory, HistoryAnalysis, PortfolioTrade, MarketQuote, PortfolioSummary, PositionValuation, PortfolioValuation, TimeWeightedResult } from './contracts';
import { instrumentKey, tradeSchema } from './contracts';
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => x.length < 2 ? null : Math.sqrt(x.reduce((s, v) => s + (v - mean(x)) ** 2, 0) / (x.length - 1));
const pct = (a: number, b: number) => (a / b - 1) * 100;
export function analyzeHistory(history: MarketHistory): HistoryAnalysis {
    const b = history.bars;
    const warnings: string[] = [];
    for (let i = 0; i < b.length; i++) {
        if (!Number.isFinite(b[i].close) || b[i].close <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(b[i].date) || !Number.isFinite(Date.parse(b[i].date)) || new Date(b[i].date).toISOString().slice(0, 10) !== b[i].date || (i > 0 && b[i].date <= b[i - 1].date))
            throw new Error('History must contain positive finite closes and unique ascending dates.');
    }
    if (history.adjustment === 'raw' || history.adjustment === 'unknown')
        warnings.push('Raw or unknown corporate-action adjustment: price gaps can distort risk and momentum. Adjusted-series metrics are withheld.');
    const hasGaps = b.some((bar, i) => i > 0 && Date.parse(bar.date) - Date.parse(b[i - 1].date) > 7 * 86400000);
    if (hasGaps)
        warnings.push('Daily history has gaps longer than seven calendar days; adjusted return/risk metrics are withheld.');
    const n = b.length;
    const prices = b.map(x => x.close);
    const returns = prices.slice(1).map((p, i) => p / prices[i] - 1);
    const safe = !hasGaps && (history.adjustment === 'split_adjusted' || history.adjustment === 'split_dividend_adjusted');
    const ret = (days: number) => safe && n > days ? pct(prices[n - 1], prices[n - 1 - days]) : null;
    let peak = prices[0] ?? 0, drawdown = 0;
    for (const p of prices) {
        peak = Math.max(peak, p);
        drawdown = Math.max(drawdown, (1 - p / peak) * 100);
    }
    if (n < 253)
        warnings.push('At least 253 observed daily closes are required for a twelve-month and twelve-minus-one-month momentum measure.');
    if (n < 62)
        warnings.push('Fewer than 61 daily returns: annualized risk/return estimates are withheld.');
    if (history.adjustment === 'split_dividend_adjusted')
        warnings.push('Series is dividend-and-split adjusted; returns are an adjusted-series proxy, not price-only performance.');
    const sma = (d: number) => safe && n >= d ? mean(prices.slice(-d)) : null;
    const s200 = sma(200);
    return { observations: n, firstDate: b[0]?.date ?? null, lastDate: b[n - 1]?.date ?? null, annualizedReturn: safe && n >= 62 ? (Math.pow(prices[n - 1] / prices[0], 252 / (n - 1)) - 1) * 100 : null, annualizedVolatility: safe && returns.length >= 61 ? (sd(returns) ?? 0) * Math.sqrt(252) * 100 : null, maxDrawdown: safe && n >= 2 ? drawdown : null, return1m: ret(21), return3m: ret(63), return6m: ret(126), return1y: ret(252), momentum12minus1: safe && n >= 253 ? pct(prices[n - 22], prices[n - 253]) : null, sma50: sma(50), sma200: s200, priceVsSma200: s200 !== null ? pct(prices[n - 1], s200) : null, warnings };
}
/** Align dates and require consecutive common sessions; never correlate mismatched return intervals. */
export function priceCorrelation(a: MarketHistory, b: MarketHistory, minObservations = 60): {
    value: number | null;
    observations: number;
    warnings: string[];
} {
    const warnings: string[] = [];
    analyzeHistory(a);
    analyzeHistory(b);
    if (a.currency !== b.currency || !a.currency)
        return { value: null, observations: 0, warnings: ['Cross-currency correlation requires aligned FX-adjusted returns.'] };
    if ([a, b].some(h => h.adjustment === 'raw' || h.adjustment === 'unknown'))
        return { value: null, observations: 0, warnings: ['Adjusted histories are required for correlation.'] };
    const am = new Map(a.bars.slice(1).map((x, i) => [a.bars[i].date + '/' + x.date, x.close / a.bars[i].close - 1]));
    const pairs = b.bars.slice(1).map((x, i) => [am.get(b.bars[i].date + '/' + x.date), x.close / b.bars[i].close - 1]).filter((x): x is [
        number,
        number
    ] => x[0] !== undefined);
    if (pairs.length < minObservations)
        return { value: null, observations: pairs.length, warnings: ['Insufficient aligned return intervals for correlation.'] };
    const x = pairs.map(p => p[0]), y = pairs.map(p => p[1]), mx = mean(x), my = mean(y);
    const den = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0));
    if (den === 0)
        return { value: null, observations: pairs.length, warnings: ['Correlation is undefined for a constant return series.'] };
    return { value: Math.max(-1, Math.min(1, x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / den)), observations: pairs.length, warnings };
}
/** Long-only recorded trades. Fees are in trade currency. No cash balance, dividend, tax, FX or broker reconciliation is implied. */
export function calculatePortfolio(trades: PortfolioTrade[], quotes: MarketQuote[], options: {
    costBasis: 'fifo' | 'average';
    now?: Date;
    maxQuoteAgeDays?: number;
} = { costBasis: 'fifo' }): PortfolioSummary {
    if (!['fifo', 'average'].includes(options.costBasis))
        throw new Error('Unsupported cost-basis method.');
    const now = options.now ?? new Date();
    const validated = trades.map(t => tradeSchema.parse(t));
    if (new Set(validated.map(t => t.id)).size !== validated.length)
        throw new Error('Trade IDs must be unique.');
    const grouped = new Map<string, PortfolioTrade[]>();
    for (const t of validated) {
        if (t.quantity * t.price + t.fees > 1e12)
            throw new Error('Trade notional exceeds the supported bound.');
        if (Date.parse(t.executedAt) > now.getTime() + 86400000)
            throw new Error('Future trades are not supported.');
        if (t.instrument.currency && t.instrument.currency !== t.currency)
            throw new Error('Trade and instrument currency disagree.');
        const k = instrumentKey(t.instrument);
        const rows = grouped.get(k) ?? [];
        rows.push(t);
        grouped.set(k, rows);
    }
    const positions: PositionValuation[] = [];
    for (const [key, rows] of grouped) {
        rows.sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt));
        const currency = rows[0].currency;
        if (rows.some(t => t.currency !== currency))
            throw new Error('A security ledger cannot mix currencies.');
        let quantity = 0, basis = 0, realized = 0;
        const lots: {
            q: number;
            unit: number;
        }[] = [];
        for (const t of rows) {
            if (t.side === 'BUY') {
                const cost = t.quantity * t.price + t.fees;
                quantity += t.quantity;
                basis += cost;
                lots.push({ q: t.quantity, unit: cost / t.quantity });
            }
            else {
                const tolerance = Number.EPSILON * Math.max(quantity, t.quantity) * 8;
                if (t.quantity > quantity + tolerance)
                    throw new Error('Sale exceeds recorded long-only holdings.');
                let soldBasis = 0;
                if (options.costBasis === 'average') {
                    soldBasis = basis / quantity * t.quantity;
                }
                else {
                    let remaining = Math.min(t.quantity, quantity);
                    while (remaining > 0) {
                        const lot = lots[0];
                        if (!lot) {
                            if (remaining <= tolerance)
                                break;
                            throw new Error('Missing acquisition lot.');
                        }
                        const take = Math.min(remaining, lot.q);
                        soldBasis += take * lot.unit;
                        remaining -= take;
                        lot.q -= take;
                        if (lot.q <= 0)
                            lots.shift();
                    }
                }
                realized += t.quantity * t.price - t.fees - soldBasis;
                quantity -= t.quantity;
                basis -= soldBasis;
                if (quantity <= tolerance) {
                    quantity = 0;
                    basis = 0;
                    lots.length = 0;
                }
            }
        }
        const matches = quotes.filter(q => instrumentKey(q.instrument) === key);
        if (matches.length > 1)
            throw new Error('Multiple quote identities for a position.');
        const q = matches[0];
        const usable = q && q.currency === currency && Number.isFinite(q.price) && q.price > 0 && Number.isFinite(Date.parse(q.asOf)) && Date.parse(q.asOf) <= now.getTime() + 86400000;
        const stale = usable && (now.getTime() - Date.parse(q.asOf)) / (86400000) > (options.maxQuoteAgeDays ?? 7);
        const warnings: string[] = [];
        if (!usable && quantity > 0)
            warnings.push('No valid same-currency quote for this position.');
        if (stale)
            warnings.push('Quote is older than the permitted valuation age; aggregate valuation is incomplete.');
        const priced = quantity === 0 ? 0 : usable && !stale ? q.price : null;
        const value = priced === null ? null : quantity * priced;
        positions.push({ instrument: rows[0].instrument, currency, quantity, averageCost: quantity > 0 ? basis / quantity : null, costBasis: basis, realizedPnl: realized, unrealizedPnl: value === null ? null : value - basis, marketValue: value, price: priced, priceAsOf: q?.asOf ?? null, status: quantity === 0 || usable && !stale ? 'valued' : stale ? 'stale_quote' : 'missing_quote', warnings });
    }
    const byCurrency = [...new Set(positions.map(p => p.currency))].map(currency => { const p = positions.filter(p => p.currency === currency), open = p.filter(p => p.quantity > 0), valid = open.filter(p => p.marketValue !== null), complete = valid.length === open.length; const total = valid.reduce((s, p) => s + p.marketValue!, 0); return { currency, costBasis: p.reduce((s, p) => s + p.costBasis, 0), marketValue: complete ? total : null, realizedPnl: p.reduce((s, p) => s + p.realizedPnl, 0), unrealizedPnl: complete ? p.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0) : null, pricedCostBasis: valid.reduce((s, p) => s + p.costBasis, 0), quoteCoverage: open.length ? valid.length / open.length : 1, largestPositionWeight: complete && total > 0 ? Math.max(...valid.map(p => p.marketValue! / total)) : null, herfindahl: complete && total > 0 ? valid.reduce((s, p) => s + (p.marketValue! / total) ** 2, 0) : null }; });
    return { costBasisMethod: options.costBasis, positions, byCurrency, warnings: ['Recorded-trade P&L excludes unrecorded dividends, taxes, cash, corporate actions and FX. Reconcile corporate actions and lot history with the broker.', 'P&L divided by purchase cost is not time-weighted investment performance.', ...(byCurrency.length > 1 ? ['Currency groups are intentionally separate; no base-currency total without actual FX valuations.'] : [])] };
}
export function computeTimeWeightedReturn(valuations: PortfolioValuation[], options: {
    flowsComplete: boolean;
}): TimeWeightedResult {
    const fail = (message: string): TimeWeightedResult => ({ returnPercent: null, periods: 0, status: 'insufficient_data', warnings: [message] });
    if (!options.flowsComplete)
        return fail('Complete external cash-flow history and valuations at every flow are required.');
    if (valuations.length < 2)
        return fail('Opening and closing valuations are required.');
    const currency = valuations[0].currency;
    let growth = 1;
    for (let i = 0; i < valuations.length; i++) {
        const v = valuations[i];
        if (v.currency !== currency || !Number.isFinite(v.valueBeforeFlow) || !Number.isFinite(v.externalFlow) || v.valueBeforeFlow < 0 || !Number.isFinite(Date.parse(v.at)) || (i > 0 && Date.parse(v.at) <= Date.parse(valuations[i - 1].at)))
            return fail('Valuations must be finite, chronological and in one currency.');
        if (i) {
            const opening = valuations[i - 1].valueBeforeFlow + valuations[i - 1].externalFlow;
            if (opening <= 0)
                return fail('A subperiod has no positive invested capital.');
            growth *= v.valueBeforeFlow / opening;
        }
    }
    if (valuations[valuations.length - 1].externalFlow !== 0)
        return fail('Closing valuation must be supplied after the final external flow.');
    return { returnPercent: (growth - 1) * 100, periods: valuations.length - 1, status: 'available', warnings: ['True subperiod linking assumes all external flows are recorded and each value is observed immediately before its flow. This is not a GIPS compliance claim.'] };
}
