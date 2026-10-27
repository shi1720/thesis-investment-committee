import { allocatePlan, type AllocationCandidate, type PlanAllocation } from '../../lib/finance/allocation';
import { selectResearchUniverse, type ResearchInstrument } from '../../lib/finance/universe';
import { analyzeHistory } from '../../lib/finance/math';
import { convertHistoryToBase } from '../../lib/finance/fx';
import { instrumentKey, type InstrumentRef, type MarketHistory, type ProviderResult, type MarketQuote } from '../../lib/finance/contracts';
import { planProfileSchema, type PlanProfile, type PersonalizedPlan, type PlanAllocationRow } from '../../lib/planning/contracts';
import { AI_ROLES, type AgentEvidence, type PublicAISettings, type ResolvedModel, type ResearchAgentEvent, type ResearchAgentTools } from '../../lib/ai/types';
import { AIClient } from '../../lib/ai/client';
import { AIError } from '../../lib/ai/errors';
import { safeSourceUrl, searchWeb } from '../../lib/ai/search';
import { observedHistory, observedQuote, observedFXHistory } from './market-service';
import { aiSettings } from './settings';
import { recallPlatformMemory } from './memory';
import { publicNews } from './news';
import { runResearchAgents, type AgentRunnerOptions } from './agent-runner';

const METHODOLOGY = [
    { label: 'Allocation and time horizon', url: 'https://www.investor.gov/introduction-investing/getting-started/asset-allocation' },
    { label: 'Risk tolerance and short-term goals', url: 'https://www.investor.gov/introduction-investing/investing-basics/save-and-invest/gauge-your-risk-tolerance' },
    { label: 'Allocation implementation and explicit policy heuristics', url: 'https://github.com/shi1720/thesis-investment-committee/blob/main/lib/finance/allocation.ts' },
];
type EventSink = (event: ResearchAgentEvent) => Promise<void>;
type ReviewState = { status: 'unconfigured' | 'completed' | 'incomplete' | 'failed'; message: string };
type SourceMetadata = Record<string, unknown>;
const essential = (p: PlanProfile) => p.principalNeededAtHorizon || p.goal === 'specific_purchase' || p.goal === 'capital_preservation';
const deadlineReserve = (p: PlanProfile) => essential(p) && p.horizonMonths <= 24;
function cents(value: number): number {
    if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-5)
        throw new Error('Plan amounts require finite nonnegative monetary values with at most two decimals.');
    return Math.round(value * 100);
}
const money = (v: number) => Math.round(v * 100) / 100;
const dateWithin = (value: string | null, now: Date, days: number) => !!value && Number.isFinite(Date.parse(value)) &&
    Date.parse(value) <= now.getTime() + 86400000 && now.getTime() - Date.parse(value) <= days * 86400000;
const successful = (v: ProviderResult<unknown>) => ['ok', 'partial'].includes(v.status) && v.data !== null;

/** Explicit metadata allowlist excludes credentials and raw vendor envelopes. */
function sourceMetadata(value: ProviderResult<MarketHistory | MarketQuote>): SourceMetadata {
    const p = value.provenance;
    return { status: value.status, provenance: { provider: p.provider, fetchedAt: p.fetchedAt, asOf: p.asOf,
        sourceUrl: safeSourceUrl(p.sourceUrl) ?? null, currency: p.currency, timezone: p.timezone, adjustment: p.adjustment, delay: p.delay },
        warnings: value.warnings.slice(0, 20), ...(value.data && 'bars' in value.data ? {
            observations: value.data.bars.length, firstDate: value.data.bars[0]?.date ?? null,
            lastDate: value.data.bars.at(-1)?.date ?? null, priceCurrency: value.data.currency } : {}) };
}
/** Zero investable budget is represented directly, without an artificial one-cent allocation. */
function zeroAllocation(currency: string): PlanAllocation {
    return { status: 'cash_only', currency, amount: 0, allocations: [], excluded: [], investedAmount: 0,
        reservedAmount: 0, estimatedVolatility: null, observedVolatilityUpperBound: 0, marketMix: {},
        volatilityMethod: 'No investable market budget remains after the immediate-needs reserve. No observed market volatility estimate is asserted.',
        warnings: ['The full budget is reserved for immediate needs. Reserve accessibility, inflation and bank counterparty risk still require review.'],
        methodology: ['The immediate-needs reserve is separated in monetary cents before any market allocation.'] };
}

export function composePersonalizedPlan(id: string, profile: PlanProfile, allocation: PlanAllocation,
    quotes: Map<string, MarketQuote>, dataAvailable: boolean,
    options: { now?: Date; sourceMetadata?: SourceMetadata[] } = {}): PersonalizedPlan {
    const now = options.now ?? new Date(), totalCents = cents(profile.amount), reserveCents = cents(profile.emergencyReserve), investableCents = totalCents - reserveCents;
    if (investableCents < 0 || cents(allocation.amount) !== investableCents || allocation.currency !== profile.baseCurrency)
        throw new Error('The allocation budget must exactly match the budget remaining after the reserve.');
    const allocations: PlanAllocationRow[] = allocation.allocations.map(row => {
        const quote = row.instrument ? quotes.get(instrumentKey(row.instrument)) : undefined;
        const observedPrice = quote && Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null;
        const sameCurrency = row.instrument?.currency === profile.baseCurrency && quote?.currency === profile.baseCurrency;
        const usableQuote = !!quote && dateWithin(quote.asOf, now, 7);
        return { id: row.id, name: row.instrument?.name ?? row.instrument?.symbol ?? (row.category === 'bank_deposit' && profile.includeDeposits
            ? 'Matched-maturity deposit category' : profile.includeDeposits ? 'Cash or a matched-maturity deposit reserve' : 'Uncommitted cash reserve'),
            symbol: row.instrument?.symbol ?? null, market: row.instrument?.market ?? null, sector: row.sector,
            assetClass: row.category, amount: row.amount, weightPercent: cents(row.amount) / totalCents * 100, currency: profile.baseCurrency,
            units: observedPrice && sameCurrency && usableQuote ? Math.floor(row.amount / observedPrice) : null,
            price: observedPrice, priceCurrency: quote?.currency ?? null, priceAsOf: quote?.asOf ?? null, reason: row.reason,
            risks: row.instrument ? ['Historical sizing cannot cap future losses. Brokerage eligibility, fees, taxes, lot sizes and liquidity need checking.',
                ...(sameCurrency ? ['Whole-unit estimates exclude fees and leave any remainder inside the allocated budget.']
                    : ['Allocation amount uses the budget currency; listing price uses its displayed quote currency. Units remain unavailable until actual execution FX and lot rules are known.']),
                ...(!usableQuote ? ['A current verified quote is missing; no executable share quantity is inferred.'] : [])]
                : profile.includeDeposits ? ['This is a reserved category, not a selected deposit product or a verified interest rate. Check maturity, withdrawal penalties, bank risk and deposit protection.'] : ['This is a cash reserve category. Verify account accessibility, bank counterparty risk and inflation exposure. No interest rate is assumed.'],
            status: row.instrument ? 'research_candidate' : 'reserve', sourceIds: row.instrument ? ['history:' + instrumentKey(row.instrument)] : [] };
    });
    if (reserveCents > 0) allocations.push({ id: 'emergency-reserve', name: 'Immediate-needs reserve', symbol: null,
        market: null, sector: null, assetClass: 'cash_reserve', amount: reserveCents / 100,
        weightPercent: reserveCents / totalCents * 100, currency: profile.baseCurrency, units: null, price: null,
        priceCurrency: null, priceAsOf: null, reason: 'Held apart before sizing any market investment.',
        risks: ['Choose an accessible account and verify its terms. Inflation and bank counterparty risk remain.'], status: 'reserve', sourceIds: [] });
    const allocatedCents = allocations.reduce((sum, row) => sum + cents(row.amount), 0);
    if (allocatedCents !== totalCents) throw new Error('The composed allocation does not conserve the monetary budget.');
    const marketAmount = allocations.filter(row => row.symbol).reduce((sum, row) => sum + row.amount, 0);
    const fundAmount = allocations.filter(row => row.assetClass === 'fixed_income_fund').reduce((sum, row) => sum + row.amount, 0), equityAmount = marketAmount - fundAmount;
    const budgetFraction = investableCents / totalCents, observedBound = allocation.observedVolatilityUpperBound * budgetFraction;
    const estimatedVolatility = allocation.estimatedVolatility === null ? null : allocation.estimatedVolatility * budgetFraction;
    const scenarios = marketAmount > 0 ? [
        { name: 'Market decline', assumption: 'Assume equity market values fall20%, fixed-income funds fall5%, and nominal reserves are unchanged before fees, taxes and inflation. These chosen base-currency shocks have no probability attached.', lossAmount: money(equityAmount * .20 + fundAmount * .05), endingAmount: money(profile.amount - equityAmount * .20 - fundAmount * .05), probability: null },
        { name: 'Severe market decline', assumption: 'Assume equity market values fall35%, fixed-income funds fall10%, and nominal reserves are unchanged. Actual losses, bank risk and currency movements can be worse.', lossAmount: money(equityAmount * .35 + fundAmount * .10), endingAmount: money(profile.amount - equityAmount * .35 - fundAmount * .10), probability: null },
    ] : [];
    const marketRequired = investableCents > 0 && !deadlineReserve(profile) && profile.maxVolatility > 0 && profile.maxLoss > 0 && (profile.includeStocks || profile.includeETFs) && (profile.allowForeign || profile.preferredMarkets.some(market => market === profile.residenceCountry));
    return { id, createdAt: now.toISOString(), status: marketRequired && !dataAvailable ? 'needs_data' : 'conditional', profile,
        summary: investableCents === 0 ? 'The entire budget is held apart for immediate needs. No market allocation or invented return is required.'
            : deadlineReserve(profile) ? profile.includeDeposits ? 'Your essential near-term deadline takes priority. This plan reserves the budget for accessible cash or a suitable matched-maturity deposit rather than forcing market exposure.' : 'Your essential near-term deadline takes priority. This plan retains an accessible cash reserve rather than forcing market exposure.'
                : `${money(marketAmount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${profile.baseCurrency} is assigned to conditional market research candidates; ${money(profile.amount - marketAmount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${profile.baseCurrency} remains reserved.`,
        allocations, totalAllocated: allocatedCents / 100, unallocated: 0, estimatedVolatility, stressLoss: marketAmount > 0 ? scenarios[1].lossAmount : null,
        checks: [
            { name: 'Budget conserved', passed: true, detail: 'Every allocation, including the immediate-needs reserve, is counted once in monetary cents. No leverage or automatic order is created.' },
            { name: 'Observed risk sizing', passed: marketAmount > 0 ? observedBound <= profile.maxVolatility && (estimatedVolatility === null || estimatedVolatility <= profile.maxVolatility) : null,
                detail: marketAmount > 0 ? `Weighted observed volatility upper bound: ${observedBound.toFixed(2)}% of the total budget, including the immediate-needs reserve. Future volatility is unknown.` : 'No market-risk allocation is present. This does not measure bank default, inflation or liquidity risk.' },
            { name: 'Specific market data', passed: marketRequired ? dataAvailable : null,
                detail: !marketRequired ? 'This reserve allocation does not require invented stock prices, a market-data subscription or a deposit yield.' : dataAvailable ? 'Eligible candidates have sufficient dated adjusted histories in the budget currency, using observed aligned FX where necessary.' : 'Specific stock allocations require sufficient dated adjusted data, actual aligned FX where needed and suitable provider entitlements.' },
            { name: 'Deadline capacity', passed: true, detail: deadlineReserve(profile) ? 'Essential deadlines of two years or less reserve principal under this explicit product policy.' : 'Risk capacity reflects the horizon as well as subjective comfort.' },
        ],
        assumptions: [...(marketAmount > 0 ? [...allocation.methodology, allocation.volatilityMethod,
            'Displayed observed risk and covariance volatility are scaled from the investable amount to the entire budget after separating the immediate-needs reserve, under a flat nominal base-currency reserve assumption.'] : ['This cash-only allocation follows the stated deadline, liquidity and reserve policy. No stock history, portfolio covariance or measured reserve volatility was calculated.',
            'Bank default, inflation, access restrictions and withdrawal penalties remain relevant. No deposit rate or nominal return is supplied.']),
            'This plan allocates the new lump sum only. It does not rebalance existing holdings or represent whole-portfolio risk.',
            'No deposit rate, investment return, tax outcome or broker access is assumed.', ...(profile.monthlyContribution > 0 ? ['Monthly contributions are recorded as a preference; this allocation covers the current lump sum only.'] : [])],
        risks: [...(marketAmount > 0 ? allocation.warnings : ['No market allocation or measured market-volatility estimate is present. This does not establish a maximum future loss.', profile.includeDeposits ? 'Cash and deposits still require review of bank solvency, access restrictions, inflation, tax and any withdrawal penalties.' : 'Cash reserves still require review of bank solvency, access restrictions, inflation, tax and account fees.', 'No deposit interest rate, deposit protection amount or investment return is assumed.']), 'Country of residence does not by itself establish eligibility to buy a foreign security. Check broker access, currency conversion, reporting, fees and local rules.'],
        nextSteps: [...(marketRequired && !dataAvailable ? ['Connect an appropriately entitled market-data provider and obtain sufficient adjusted stock and, where necessary, FX history.'] : []),
            profile.includeDeposits ? 'Compare deposit maturity and liquidity with the date you need the money.' : 'Verify cash accessibility and account terms against the date you need the money.', marketAmount > 0 ? 'Review the cited evidence and counterargument before acting.' : profile.includeDeposits ? 'Verify the reserve account or deposit terms, maturity, accessibility and protection before committing funds.' : 'Verify the cash account terms, accessibility and bank protection before committing funds.', 'Revisit the plan when your goal, cash needs, source data or risk capacity changes.'],
        research: null, methodology: METHODOLOGY.map(item => ({ ...item })), scenarios,
        alternatives: [{ name: 'Keep the deadline firm', description: 'Recalculate with principal needed at the goal date.', profilePatch: { principalNeededAtHorizon: true } },
            { name: 'Give the goal more time', description: 'Compare a longer horizon without assuming higher future returns.', profilePatch: { horizonMonths: Math.max(profile.horizonMonths, 60), principalNeededAtHorizon: false } },
            { name: 'Reduce concentration', description: 'Compare smaller individual positions and sector exposure.', profilePatch: { maxPositionWeight: 5, maxSectorWeight: 20 } }],
        allocationDetails: { ...allocation, ...(marketAmount === 0 ? { methodology: ['Cash-only reserve policy for the supplied goal, deadline and liquidity needs.'], volatilityMethod: 'No adjusted-history, portfolio covariance or market-volatility estimate was computed for this reserve-only result.' } : {}), originalRiskDenominator: marketAmount > 0 ? 'investable budget after immediate-needs reserve' : 'No invested market exposure; no measured market-risk denominator',
            totalBudgetRisk: { investableFraction: budgetFraction, observedVolatilityUpperBound: marketAmount > 0 ? observedBound : null, estimatedVolatility }, sourceMetadata: options.sourceMetadata ?? [] },
    };
}

export interface PlanningDependencies {
    now: () => Date; universe: (profile: PlanProfile) => ResearchInstrument[];
    history: typeof observedHistory; quote: typeof observedQuote; fxHistory: typeof observedFXHistory;
    getAISettings: (userId: string) => Promise<PublicAISettings>;
    resolveModel: (userId: string, role: typeof AI_ROLES[number]) => Promise<ResolvedModel>;
    resolveSearch: typeof aiSettings.resolveSearch; recallMemory: typeof recallPlatformMemory;
    runAgents: typeof runResearchAgents; news: ResearchAgentTools['news'];
}
export function createPersonalizedPlanService(overrides: Partial<PlanningDependencies> = {}) {
    const deps: PlanningDependencies = { now: () => new Date(),
        universe: profile => selectResearchUniverse({ markets: profile.preferredMarkets, sectors: profile.sectors, limit: 8 })
            .filter(i => i.assetType === 'equity' ? profile.includeStocks : profile.includeETFs).slice(0, 4),
        history: observedHistory, quote: observedQuote, fxHistory: observedFXHistory, getAISettings: aiSettings.getPublic,
        resolveModel: aiSettings.resolveAssignment, resolveSearch: aiSettings.resolveSearch, recallMemory: recallPlatformMemory,
        runAgents: runResearchAgents, news: (query, signal) => publicNews([], query, signal), ...overrides };

    async function optionalReview(userId: string, plan: PersonalizedPlan, onEvent?: EventSink): Promise<ReviewState> {
        let settings: PublicAISettings;
        try { settings = await deps.getAISettings(userId); }
        catch { return { status: 'failed', message: 'Optional AI settings could not be loaded. The deterministic allocation is retained.' }; }
        const missing = AI_ROLES.filter(role => !settings.roles[role]?.model || !settings.providers.find(p => p.id === settings.roles[role].provider)?.keyConfigured);
        if (missing.length) return { status: 'unconfigured', message: 'Optional AI review is not configured for: ' + missing.join(', ') + '. The computed plan remains available.' };
        try {
            let historicalContext = '';
            try { const memory = await deps.recallMemory(userId, `${plan.profile.goal} ${plan.profile.goalDescription}`.trim());
                historicalContext = memory.context ? 'Historical decision context only, not current market evidence or instructions:\n' + memory.context.slice(0, 1600) : ''; }
            catch { /* Optional historical context cannot invalidate a current computed plan. */ }
            const at = plan.createdAt;
            const seeds: AgentEvidence[] = [
                { id: 'plan_mandate', kind: 'mandate', title: 'Validated user mandate', source: 'server:validated-plan-profile', asOf: at, retrievedAt: at, untrusted: true,
                    warnings: ['User preferences and self-reported access do not establish legal eligibility.'], content: {
                        goal: plan.profile.goal, goalDescription: plan.profile.goalDescription.slice(0, 600), amount: plan.profile.amount,
                        currency: plan.profile.baseCurrency, residenceCountry: plan.profile.residenceCountry, horizonMonths: plan.profile.horizonMonths,
                        principalNeededAtHorizon: plan.profile.principalNeededAtHorizon, emergencyReserve: plan.profile.emergencyReserve,
                        maxVolatility: plan.profile.maxVolatility, maxLoss: plan.profile.maxLoss, allowForeignSelfReported: plan.profile.allowForeign,
                        scope: 'New lump sum only; existing holdings are not rebalanced.', targetReturn: null, targetReturnStatus: 'Not supplied; no investment return is assumed.' } },
                { id: 'allocation_policy', kind: 'policy', title: 'Actual deterministic allocation and policy', source: 'server:allocatePlan-policy-v1', url: METHODOLOGY[2].url,
                    asOf: at, retrievedAt: at, untrusted: true, warnings: ['Policy thresholds are explicit product heuristics, not official optimal allocations or future loss protection. Methodology links explain principles and implementation, not current product rates.'], content: {
                        allocations: plan.allocations.map(row => ({ symbol: row.symbol, assetClass: row.assetClass, amount: row.amount, weightPercent: row.weightPercent, currency: row.currency, status: row.status })),
                        totalAllocated: plan.totalAllocated, estimatedVolatilityTotalBudget: plan.estimatedVolatility, illustrativeStressLoss: plan.stressLoss,
                        checks: plan.checks.map(check => ({ name: check.name, passed: check.passed })),
                        policy: 'Separate emergency reserve; essential goals within two years reserve capital. Eligible risk allocations require dated adjusted observations and actual aligned FX in the budget currency. Historical risk and chosen shocks are not future maximum-loss guarantees.', methodology: METHODOLOGY } },
            ];
            const outsideScope = async () => { throw new AIError('tool_scope', 'The plan critique has no approved stock lookup scope.'); };
            const tools: ResearchAgentTools = { quote: outsideScope, history: outsideScope, fundamentals: outsideScope, news: deps.news };
            try { const search = await deps.resolveSearch(userId); if (search) tools.webSearch = (query, signal) => searchWeb(search, query, { signal }); }
            catch { /* No replacement search result is fabricated. */ }
            const options: AgentRunnerOptions = { tools, resolveModel: role => deps.resolveModel(userId, role), budget: settings.budget,
                seedEvidence: seeds, onEvent, client: new AIClient({ nightshiftBaseUrl: process.env.NIGHTSHIFT_BASE_URL }) };
            const report = await deps.runAgents({ kind: 'plan', markets: plan.profile.preferredMarkets, sectors: plan.profile.sectors, symbols: [],
                question: 'Critique this computed allocation against the validated goal, deadline, liquidity and risk constraints. Keep all computed weights and amounts unchanged. No return target or product rate is assumed. Every finding must use symbol:null and cite the supplied mandate or policy; no stock lookup scope is approved. Identify evidence and eligibility gaps conditionally.',
                portfolioContext: historicalContext,
                risk: { targetReturn: 0, maxVolatility: plan.profile.maxVolatility, maxDrawdown: plan.profile.maxLoss, horizonMonths: plan.profile.horizonMonths } }, options);
            plan.research = report;
            return { status: report.status, message: report.status === 'completed' ? 'An actual model review completed. Its qualitative critique cannot alter computed allocations.' : report.error?.message ?? 'The optional model review did not complete. The deterministic allocation is retained.' };
        } catch { return { status: 'failed', message: 'The optional model review could not complete. The deterministic allocation is retained.' }; }
    }

    async function build(userId: string, id: string, raw: unknown, onEvent?: EventSink): Promise<PersonalizedPlan> {
        const profile = planProfileSchema.parse(raw), now = deps.now(), budget = (cents(profile.amount) - cents(profile.emergencyReserve)) / 100;
        const candidates: AllocationCandidate[] = [], quotes = new Map<string, MarketQuote>(), sources: SourceMetadata[] = [];
        const fxCache = new Map<string, Promise<ProviderResult<MarketHistory>>>();
        const marketAllowed = !deadlineReserve(profile) && budget > 0 && profile.maxVolatility > 0 && profile.maxLoss > 0 && (profile.includeStocks || profile.includeETFs);
        if (marketAllowed) for (const instrument of deps.universe(profile)) {
            const key = instrumentKey(instrument), metadata: SourceMetadata = { instrument: { ...instrument }, eligibleForRisk: false }; sources.push(metadata);
            let riskHistory: MarketHistory | null = null, eligible = false;
            if (!profile.allowForeign && instrument.market !== profile.residenceCountry) metadata.warnings = ['Foreign investments are disabled in the validated mandate. No source request was made.'];
            else try {
                await onEvent?.({ id: crypto.randomUUID(), at: now.toISOString(), stage: 'allocation-data', type: 'tool', message: 'Check dated adjusted history for ' + instrument.symbol });
                const stock = await deps.history(userId, instrument); metadata.stock = sourceMetadata(stock);
                if (successful(stock) && stock.data && instrumentKey(stock.data.instrument) === key && (!instrument.currency || stock.data.currency === instrument.currency) && (!stock.data.instrument.currency || stock.data.instrument.currency === stock.data.currency) && (!stock.provenance.currency || stock.provenance.currency === stock.data.currency)) {
                    riskHistory = stock.data;
                    if (riskHistory.currency !== profile.baseCurrency) {
                        const listingCurrency = riskHistory.currency;
                        if (listingCurrency) {
                            const pair = listingCurrency + '/' + profile.baseCurrency;
                            if (!fxCache.has(pair)) fxCache.set(pair, deps.fxHistory(userId, listingCurrency, profile.baseCurrency));
                            const fx = await fxCache.get(pair)!; metadata.fx = sourceMetadata(fx);
                            if (successful(fx) && fx.data && (!fx.provenance.currency || fx.provenance.currency === fx.data.currency)) {
                                const converted = convertHistoryToBase(riskHistory, fx.data, { baseCurrency: profile.baseCurrency, quoteCurrency: listingCurrency, orientation: 'base_per_listing' });
                                metadata.fxConversion = { coverage: converted.coverage, warnings: converted.warnings };
                                riskHistory = converted.coverage.eligibleForRisk ? converted.history : null;
                            } else riskHistory = null;
                        } else riskHistory = null;
                    }
                    if (riskHistory && riskHistory.instrument.currency && riskHistory.instrument.currency !== instrument.currency) riskHistory = null;
                    if (riskHistory) {
                        const analysis = analyzeHistory(riskHistory); metadata.analysis = analysis;
                        eligible = analysis.observations >= 253 && riskHistory.currency === profile.baseCurrency &&
                            ['split_adjusted', 'split_dividend_adjusted'].includes(riskHistory.adjustment) && analysis.annualizedVolatility !== null &&
                            Number.isFinite(analysis.annualizedVolatility) && analysis.annualizedVolatility > 0 && analysis.maxDrawdown !== null &&
                            Number.isFinite(analysis.maxDrawdown) && dateWithin(analysis.lastDate, now, 14);
                    }
                }
            } catch { metadata.warnings = ['The required observed history or FX history could not be loaded. No replacement observation was created.']; riskHistory = null; }
            metadata.eligibleForRisk = eligible;
            const analysis = eligible && riskHistory ? analyzeHistory(riskHistory) : null;
            const returns = eligible && riskHistory ? riskHistory.bars.slice(1).map((bar, i) => ({ date: riskHistory!.bars[i].date + '/' + bar.date, value: bar.close / riskHistory!.bars[i].close - 1 })) : undefined;
            candidates.push({ instrument: { ...instrument }, sector: instrument.sector, assetType: instrument.assetType, verified: eligible,
                annualVolatility: analysis?.annualizedVolatility ?? null, maxDrawdown: analysis?.maxDrawdown ?? null,
                observations: analysis?.observations ?? 0, asOf: analysis?.lastDate ?? null, riskCurrency: riskHistory?.currency ?? null, returns });
        }
        const allocation = budget === 0 ? zeroAllocation(profile.baseCurrency) : allocatePlan({ amount: budget, baseCurrency: profile.baseCurrency,
            residenceCountry: profile.residenceCountry, horizonMonths: profile.horizonMonths, goal: profile.goal, principalNeededAtHorizon: profile.principalNeededAtHorizon,
            maxVolatility: profile.maxVolatility, maxLoss: profile.maxLoss, maxPositionWeight: profile.maxPositionWeight / 100, maxSectorWeight: profile.maxSectorWeight / 100,
            marketWeights: profile.marketWeights ? Object.fromEntries(Object.entries(profile.marketWeights).map(([market, value]) => [market, value / 100])) : undefined,
            allowForeign: profile.allowForeign }, candidates, { now });
        // Quotes support displayed prices and conditional units, never historical risk eligibility.
        for (const row of allocation.allocations) if (row.instrument) try {
            const quote = await deps.quote(userId, row.instrument), metadata = sources.find(source => instrumentKey(source.instrument as InstrumentRef) === instrumentKey(row.instrument!));
            if (metadata) metadata.quote = sourceMetadata(quote);
            if (successful(quote) && quote.data && instrumentKey(quote.data.instrument) === instrumentKey(row.instrument) && quote.data.currency === row.instrument.currency && Number.isFinite(Date.parse(quote.data.asOf)) && Date.parse(quote.data.asOf) <= now.getTime() + 86400000 && Number.isFinite(quote.data.price) && quote.data.price > 0)
                quotes.set(instrumentKey(row.instrument), quote.data);
        } catch { sources.push({ instrument: { ...row.instrument }, quoteWarning: 'Current quote unavailable. No executable units were inferred.' }); }
        const plan = composePersonalizedPlan(id, profile, allocation, quotes, candidates.some(candidate => candidate.verified), { now, sourceMetadata: sources });
        const review = await optionalReview(userId, plan, onEvent);
        plan.checks.push({ name: 'Optional AI review', passed: review.status === 'completed' ? true : review.status === 'unconfigured' ? null : false, detail: review.message });
        plan.allocationDetails = { ...(plan.allocationDetails as SourceMetadata), aiReview: review };
        return plan;
    }
    return { build };
}
export const buildPersonalizedPlan = (userId: string, id: string, raw: unknown, onEvent?: EventSink) => createPersonalizedPlanService().build(userId, id, raw, onEvent);
