import type { Market } from '../contracts';
import type { InstrumentRef } from './contracts';
import { instrumentKey } from './contracts';
export interface AllocationRequest {
    amount: number;
    baseCurrency: string;
    residenceCountry: Market | 'Other';
    horizonMonths: number;
    goal: 'growth' | 'income' | 'capital_preservation' | 'specific_purchase';
    principalNeededAtHorizon: boolean;
    maxVolatility: number;
    maxLoss: number;
    maxPositionWeight?: number;
    maxSectorWeight?: number;
    marketWeights?: Partial<Record<Market, number>>;
    allowForeign?: boolean;
    manualDepositWeight?: number;
}
export interface AllocationCandidate {
    instrument: InstrumentRef;
    sector: string;
    assetType: 'equity' | 'equity_fund' | 'fixed_income_fund';
    verified: boolean;
    annualVolatility: number | null;
    maxDrawdown: number | null;
    observations: number;
    asOf: string | null; /** Must equal base currency: achieved only by same-currency data or an actually aligned FX conversion. */
    riskCurrency: string | null; /** Optional aligned daily simple return intervals in riskCurrency. */
    returns?: {
        date: string;
        value: number;
    }[];
}
export interface PlanAllocation {
    status: 'conditional' | 'cash_only';
    currency: string;
    amount: number;
    allocations: {
        id: string;
        category: 'equity' | 'equity_fund' | 'fixed_income_fund' | 'cash_reserve' | 'bank_deposit';
        instrument: InstrumentRef | null;
        sector: string | null;
        amount: number;
        weight: number;
        reason: string;
        rate: number | null;
    }[];
    excluded: {
        instrument: InstrumentRef;
        reasons: string[];
    }[];
    investedAmount: number;
    reservedAmount: number;
    estimatedVolatility: number | null;
    observedVolatilityUpperBound: number;
    volatilityMethod: string;
    marketMix: Partial<Record<Market, number>>;
    warnings: string[];
    methodology: string[];
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** Deterministic policy constraints plus capped inverse-volatility allocation. No forecast or trade execution. */
export function allocatePlan(request: AllocationRequest, candidates: AllocationCandidate[], options: {
    now?: Date;
} = {}): PlanAllocation {
    const r = request;
    if (!Number.isFinite(r.amount) || r.amount <= 0 || r.amount > 1e12 || Math.abs(r.amount * 100 - Math.round(r.amount * 100)) > 1e-5)
        throw new Error('Amount must be positive, finite and have at most two currency decimals.');
    if (!/^[A-Z]{3}$/.test(r.baseCurrency))
        throw new Error('Base currency must be an ISO-style currency code.');
    if (!Number.isInteger(r.horizonMonths) || r.horizonMonths < 1 || r.horizonMonths > 600)
        throw new Error('Invalid investment horizon.');
    for (const v of [r.maxVolatility, r.maxLoss])
        if (!Number.isFinite(v) || v < 0 || v > 100)
            throw new Error('Risk limits must be between zero and one hundred percent.');
    const cap = r.maxPositionWeight ?? .15, sectorCap = r.maxSectorWeight ?? .30, deposit = r.manualDepositWeight ?? 0;
    if ([cap, sectorCap].some(v => !Number.isFinite(v) || v <= 0 || v > 1) || !Number.isFinite(deposit) || deposit < 0 || deposit > 1)
        throw new Error('Allocation weights must be finite fractions from zero to one.');
    if (new Set(candidates.map(c => instrumentKey(c.instrument))).size !== candidates.length)
        throw new Error('Allocation candidates must have unique identities.');
    const weights = r.marketWeights ?? {};
    for (const [m, w] of Object.entries(weights))
        if (!['US', 'India', 'China', 'UAE'].includes(m) || !Number.isFinite(w) || w! < 0 || w! > 1)
            throw new Error('Invalid target market mix.');
    const mixTotal = Object.values(weights).reduce((s, v) => s + (v ?? 0), 0);
    if (mixTotal > 1 + 1e-8)
        throw new Error('Target market mix exceeds one hundred percent.');
    const total = Math.round(r.amount * 100), now = (options.now ?? new Date()).getTime();
    const excluded: PlanAllocation['excluded'] = [], eligible: AllocationCandidate[] = [];
    for (const c of candidates) {
        const reasons: string[] = [];
        if (!c.verified)
            reasons.push('Verified provider observations are required.');
        if (!c.asOf || !Number.isFinite(Date.parse(c.asOf)) || now - Date.parse(c.asOf) > 14 * 86400000 || Date.parse(c.asOf) > now + 86400000)
            reasons.push('Risk observations are missing, stale or future-dated.');
        if (!Number.isInteger(c.observations) || c.observations < 253)
            reasons.push('At least 253 observed daily closes are required by this allocation policy.');
        if (c.riskCurrency !== r.baseCurrency)
            reasons.push(((c.riskCurrency&&c.riskCurrency!==r.baseCurrency)||(c.instrument.currency&&c.instrument.currency!==r.baseCurrency))?'Base-currency risk needs actual aligned FX history.':'Observed risk in the budget currency is missing or unverified.');
        if (!r.allowForeign && c.instrument.market !== r.residenceCountry)
            reasons.push('Foreign investments are disabled.');
        if (c.annualVolatility === null || !Number.isFinite(c.annualVolatility) || c.annualVolatility <= 0 || c.annualVolatility > 1000)
            reasons.push('Valid positive observed volatility is required.');
        if (c.maxDrawdown === null || !Number.isFinite(c.maxDrawdown) || c.maxDrawdown < 0 || c.maxDrawdown > 100 || c.maxDrawdown > r.maxLoss)
            reasons.push('Observed drawdown is missing or exceeds the stated research limit.');
        if (!c.sector.trim())
            reasons.push('Sector metadata is required for concentration limits.');
        if (reasons.length)
            excluded.push({ instrument: c.instrument, reasons });
        else
            eligible.push(c);
    }
    const essential = r.principalNeededAtHorizon || r.goal === 'specific_purchase' || r.goal === 'capital_preservation';
    const horizonRisk = essential && r.horizonMonths <= 24 ? 0 : r.horizonMonths <= 24 ? .20 : r.horizonMonths <= 60 ? .50 : .85;
    const capacity = Math.min(horizonRisk, r.maxLoss / 50, r.maxVolatility / 30, 1 - deposit);
    const riskBudget = Math.floor(total * clamp(capacity, 0, 1));
    const allocated = new Map<AllocationCandidate, number>();
    const sector = new Map<string, number>(), market = new Map<Market, number>();
    let remaining = riskBudget;
    // Fixed-income funds still face market/credit/duration risk and use the same measured gates. No synthetic safe asset is inserted.
    for (let pass = 0; pass < eligible.length * 4 + 4 && remaining >= 1; pass++) {
        const open = eligible.filter(c => { const w = allocated.get(c) ?? 0, mc = Object.keys(weights).length ? Math.floor(riskBudget * (weights[c.instrument.market] ?? 0)) : riskBudget; return w < Math.floor(total * cap) && (sector.get(c.sector) ?? 0) < Math.floor(total * sectorCap) && (market.get(c.instrument.market) ?? 0) < mc; });
        if (!open.length)
            break;
        const denom = open.reduce((s, c) => s + 1 / c.annualVolatility!, 0);
        const roundRemaining = remaining;
        let progress = 0;
        for (const c of open) {
            const old = allocated.get(c) ?? 0;
            const mc = Object.keys(weights).length ? Math.floor(riskBudget * (weights[c.instrument.market] ?? 0)) : riskBudget;
            const desired = Math.max(1, Math.floor(roundRemaining * (1 / c.annualVolatility!) / denom));
            const amount = Math.max(0, Math.min(desired, remaining, Math.floor(total * cap) - old, Math.floor(total * sectorCap) - (sector.get(c.sector) ?? 0), mc - (market.get(c.instrument.market) ?? 0)));
            if (!amount)
                continue;
            allocated.set(c, old + amount);
            sector.set(c.sector, (sector.get(c.sector) ?? 0) + amount);
            market.set(c.instrument.market, (market.get(c.instrument.market) ?? 0) + amount);
            remaining -= amount;
            progress += amount;
        }
        if (!progress)
            break;
    }
    const individualBound = () => [...allocated].reduce((sum, [c, cents]) => sum + cents / total * c.annualVolatility!, 0);
    // Recompute on the actually held set: dropping a position can change its common return window.
    const jointRisk = (): { value: number | null; method: string } => {
        const held = [...allocated].filter(([, cents]) => cents > 0);
        const unavailable = { value: null, method: 'Unavailable: at least sixty common dated return intervals in the base currency are required.' };
        if (!held.length)
            return unavailable;
        const maps = held.map(([c]) => new Map((c.returns ?? []).map(v => [v.date, v.value])));
        const dates = [...maps[0].keys()].filter(d => maps.every(m => m.has(d)));
        const values = dates.map(d => maps.map(m => m.get(d)!));
        if (dates.length < 60 || !values.every(row => row.every(v => Number.isFinite(v) && v >= -1)))
            return unavailable;
        const n = values.length, means = held.map((_, j) => values.reduce((sum, row) => sum + row[j], 0) / n), ws = held.map(([, cents]) => cents / total);
        let variance = 0;
        for (let i = 0; i < held.length; i++)
            for (let j = 0; j < held.length; j++) {
                const covariance = values.reduce((sum, row) => sum + (row[i] - means[i]) * (row[j] - means[j]), 0) / (n - 1);
                variance += ws[i] * ws[j] * (i === j ? covariance : .5 * covariance);
            }
        return { value: Number.isFinite(variance) ? Math.sqrt(Math.max(0, variance) * 252) * 100 : Infinity, method: 'Historical sample covariance with fixed 50% off-diagonal shrinkage toward a diagonal matrix,252-session annualization. Not the fitted Ledoit-Wolf estimator; risk-asset contribution under a flat nominal base-currency reserve assumption. Deposit default, inflation and liquidity risk are outside this estimate.' };
    };
    // Both measured windows constrain sizing. Scaling only reduces exposures, so every position/sector/market cap survives.
    let riskScaled = false;
    for (let pass = 0; pass < 32; pass++) {
        const observedRisk = Math.max(individualBound(), jointRisk().value ?? 0);
        if (observedRisk <= r.maxVolatility)
            break;
        riskScaled = true;
        const scale = r.maxVolatility / observedRisk;
        for (const [candidate, cents] of allocated)
            allocated.set(candidate, Math.floor(cents * scale));
    }
    // Guard against rounding or pathological numeric input: never return an unchanged allocation above either measured limit.
    if (Math.max(individualBound(), jointRisk().value ?? 0) > r.maxVolatility) {
        riskScaled = true;
        for (const candidate of allocated.keys())
            allocated.set(candidate, 0);
    }
    const observedVolatilityUpperBound = individualBound();
    const finalJointRisk = jointRisk();
    const estimatedVolatility = finalJointRisk.value;
    const volatilityMethod = finalJointRisk.method;
    market.clear();
    for (const [candidate, cents] of allocated)
        if (cents > 0)
            market.set(candidate.instrument.market, (market.get(candidate.instrument.market) ?? 0) + cents);
    const allocations: PlanAllocation['allocations'] = [];
    for (const [c, cents] of allocated) {
        if (cents <= 0)
            continue;
        allocations.push({ id: instrumentKey(c.instrument), category: c.assetType, instrument: c.instrument, sector: c.sector, amount: cents / 100, weight: cents / total, reason: 'Conditional research allocation using capped inverse observed volatility; source/currency/risk gates passed.', rate: null });
    }
    const investedCents = [...allocated.values()].reduce((a, b) => a + b, 0);
    let depositCents = Math.min(Math.floor(total * deposit), total - investedCents);
    if (depositCents > 0)
        allocations.push({ id: 'manual-bank-deposit', category: 'bank_deposit', instrument: null, sector: null, amount: depositCents / 100, weight: depositCents / total, reason: 'Manual deposit category only. Select a regulated product and verify rate, maturity, liquidity, tax and deposit protection before acting.', rate: null });
    const cash = total - investedCents - depositCents;
    if (cash > 0)
        allocations.push({ id: 'unallocated-cash-reserve', category: 'cash_reserve', instrument: null, sector: null, amount: cash / 100, weight: cash / total, reason: essential && r.horizonMonths <= 24 ? 'Near-term principal need reserves capital rather than overriding risk capacity with subjective tolerance.' : 'Capital reserved because of horizon, risk limits, missing data or concentration/market constraints.', rate: null });
    const held = [...allocated].filter(([, cents]) => cents > 0);
    const warnings = ['This is a conditional planning illustration, not executable orders, a return forecast or a guarantee against future losses.', 'Historical drawdown is not a future maximum-loss cap. The stated loss limit is a research constraint, not enforceable protection.', 'Deposit rates, fund yields, FX, taxes, fees, product access and protection are not invented. Verify them before any commitment.', 'Amounts use monetary cents and fractional research budgets; actual lot sizes and brokerage execution can leave extra cash.', 'Sector caps use top-level instrument labels; ETF holdings overlap and look-through sector concentration are not established.'];
    if (essential && r.horizonMonths <= 24)
        warnings.push('A two-year or shorter essential goal has no market-risk allocation under the explicit conservative policy.');
    if (excluded.length)
        warnings.push('Some candidates could not support an actionable research allocation; their proposed capital remains reserved.');
    if (riskScaled)
        warnings.push('Market allocations were reduced into cash to satisfy both the individual-window volatility bound and the available common-window covariance estimate. These are historical constraints, not future guarantees.');
    if (!held.length)
        warnings.push('No verified eligible instrument allocation was produced.');
    return { status: held.length ? 'conditional' : 'cash_only', currency: r.baseCurrency, amount: total / 100, allocations, excluded, investedAmount: investedCents / 100, reservedAmount: (total - investedCents) / 100, estimatedVolatility, observedVolatilityUpperBound, volatilityMethod, marketMix: Object.fromEntries([...market].map(([m, w]) => [m, w / total])), warnings, methodology: ['Conservative horizon/risk-capacity policy; thresholds are explicit product heuristics, not universal optimal allocations.', 'Long-only inverse-volatility budgeting with per-position/sector caps and optional market ceilings; no sample covariance inversion or target-return maximization.', 'Missing or unqualified market slices are not silently redistributed into higher-risk alternatives.', 'Measured weighted volatility upper bound assumes perfect positive correlation for sizing; it is not a future loss or volatility guarantee.'] };
}
