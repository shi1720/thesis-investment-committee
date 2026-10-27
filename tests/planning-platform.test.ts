import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalizedPlanService, composePersonalizedPlan, type PlanningDependencies } from '../server/platform/planning';
import { planProfileSchema, type PlanProfile } from '../lib/planning/contracts';
import { allocatePlan, type AllocationCandidate } from '../lib/finance/allocation';
import { analyzeHistory } from '../lib/finance/math';
import { instrumentKey, type MarketHistory, type MarketQuote, type ProviderResult, type InstrumentRef } from '../lib/finance/contracts';
import type { ResearchInstrument } from '../lib/finance/universe';
import { AI_PROVIDERS, AI_ROLES, type PublicAISettings, type ResearchAgentInput, type StructuredResearchReport } from '../lib/ai/types';
import { DEFAULT_AGENT_BUDGET } from '../server/platform/ai-settings';

const NOW = new Date('2026-10-27T12:00:00Z');
const stock: ResearchInstrument = { symbol: 'TEST', market: 'US', exchange: 'TESTEX', currency: 'USD',
    name: 'Contract fixture equity', sector: 'Technology', assetType: 'equity', metadataSource: 'https://example.test/company' };
const other: ResearchInstrument = { ...stock, symbol: 'SECOND', sector: 'Healthcare' };
const base = (patch: Partial<PlanProfile> = {}): PlanProfile => planProfileSchema.parse({
    amount: 100000, baseCurrency: 'USD', residenceCountry: 'US', goal: 'growth', horizonMonths: 120,
    principalNeededAtHorizon: false, maxVolatility: 30, maxLoss: 40, preferredMarkets: ['US'],
    allowForeign: false, maxPositionWeight: 25, maxSectorWeight: 50, ...patch,
});
function settings(configured = false): PublicAISettings {
    return { defaultProvider: 'nvidia', providers: AI_PROVIDERS.map(id => ({ id, name: id, keyConfigured: configured && id === 'nvidia',
        keySource: configured && id === 'nvidia' ? 'account' : null, keyLast4: null, models: [], catalogStatus: 'not_loaded', connection: { status: 'untested' } })),
        roles: Object.fromEntries(AI_ROLES.map(role => [role, { provider: 'nvidia', model: configured ? 'nvidia/contract-fixture' : null }])) as PublicAISettings['roles'],
        search: { provider: null, configured: false }, budget: { ...DEFAULT_AGENT_BUDGET } };
}
/** Fabricated observations only for deterministic integration contracts. */
function history(i: InstrumentRef, count = 400, fx = false): MarketHistory {
    return { instrument: { ...i }, currency: i.currency ?? null, interval: '1day', timezone: fx ? 'UTC' : 'America/New_York',
        adjustment: fx ? 'raw' : 'split_adjusted', bars: Array.from({ length: count }, (_, index) => ({
            date: new Date(NOW.getTime() - (count - 1 - index) * 86400000).toISOString().slice(0, 10),
            close: fx ? 80 * Math.exp(index * .00005 + .002 * Math.sin(index * .4)) : 100 * Math.exp(index * .0002 + .01 * Math.sin(index * .6)),
            open: null, high: null, low: null, volume: fx ? null : 1000,
        })) };
}
function result<T>(data: T | null, currency: string | null = 'USD', status: ProviderResult<T>['status'] = 'ok'): ProviderResult<T> {
    return { data, status, provenance: { provider: 'twelvedata', fetchedAt: NOW.toISOString(), asOf: NOW.toISOString().slice(0, 10),
        sourceUrl: 'https://api.twelvedata.com/time_series?symbol=TEST&apikey=private-query-key', currency,
        timezone: 'UTC', adjustment: 'split_adjusted', delay: 'end_of_day' }, warnings: [] };
}
function quote(i: InstrumentRef): ProviderResult<MarketQuote> {
    return result({ instrument: { ...i }, price: 100, previousClose: 99, change: 1, changePercent: 100 / 99,
        asOf: NOW.toISOString(), currency: i.currency ?? null }, i.currency ?? null);
}
function service(overrides: Partial<PlanningDependencies> = {}) {
    return createPersonalizedPlanService({ now: () => new Date(NOW), universe: () => [stock],
        history: async (_user, i) => result(history(i), i.currency ?? null), quote: async (_user, i) => quote(i),
        fxHistory: async () => result<MarketHistory>(null, 'INR', 'unavailable'),
        getAISettings: async () => settings(false), resolveSearch: async () => null,
        recallMemory: async () => ({ context: '', reused: false, count: 0 }), ...overrides });
}
const details = (plan: Awaited<ReturnType<ReturnType<typeof service>['build']>>) => plan.allocationDetails as Record<string, any>;

test('a full immediate-needs reserve is a real zero-investable result with exact cents and no market calls', async () => {
    let requests = 0;
    const fail = async () => { requests++; throw Error('A cash reserve requires no market endpoint'); };
    const app = service({ universe: () => { requests++; return [stock]; }, history: fail, quote: fail, fxHistory: fail });
    const plan = await app.build('owner', 'full-reserve', base({ amount: 100000.01, emergencyReserve: 100000.01 }));
    assert.equal(requests, 0); assert.equal(plan.status, 'conditional'); assert.equal(plan.totalAllocated, 100000.01);
    assert.equal(plan.unallocated, 0); assert.equal(plan.allocations.length, 1);
    assert.equal(plan.allocations[0].id, 'emergency-reserve'); assert.equal(plan.allocations[0].weightPercent, 100);
    assert.equal(details(plan).amount, 0); assert.equal(details(plan).investedAmount, 0);
    assert.equal(plan.estimatedVolatility, null); assert.equal(details(plan).aiReview.status, 'unconfigured');
    assert.equal(plan.research, null); assert.equal(plan.checks.find(c => c.name === 'Specific market data')?.passed, null);
});

test('essential purchase and capital-preservation deadlines within two years do not require stock feeds', async () => {
    for (const goal of ['specific_purchase', 'capital_preservation'] as const) {
        let requests = 0;
        const app = service({ history: async () => { requests++; throw Error('Unneeded'); }, quote: async () => { requests++; throw Error('Unneeded'); } });
        const plan = await app.build('owner', 'deadline', base({ goal, principalNeededAtHorizon: false, horizonMonths: 24, emergencyReserve: 123.45 }));
        assert.equal(requests, 0); assert.equal(plan.status, 'conditional');
        assert.equal(plan.allocations.some(row => row.symbol), false); assert.equal(plan.totalAllocated, 100000);
        assert.ok(plan.summary.includes('essential near-term')); assert.equal(plan.checks.find(c => c.name === 'Specific market data')?.passed, null);
    }
});

test('zero stated risk capacity reserves the budget without source requests or invented zero-risk returns', async () => {
    let requests = 0;
    const app = service({ history: async () => { requests++; throw Error(); } });
    const plan = await app.build('owner', 'risk-zero', base({ maxVolatility: 0, maxLoss: 0 }));
    assert.equal(requests, 0); assert.equal(plan.status, 'conditional'); assert.equal(plan.estimatedVolatility, null);
    assert.equal(plan.allocations.some(row => row.symbol), false); assert.equal(plan.totalAllocated, 100000);
});

test('disabled deposits stay cash-only in names and actions and the new-money scope is explicit', async () => {
    const plan = await service().build('owner', 'cash-wording', base({ includeDeposits: false, goal: 'specific_purchase', horizonMonths: 12 }));
    assert.ok(plan.allocations.every(row => !/deposit/i.test(row.name)));
    assert.equal(/matched-maturity deposit/i.test(plan.summary), false);
    assert.ok(plan.nextSteps.every(step => !/deposit maturity/i.test(step)));
    assert.ok(plan.assumptions.some(assumption => assumption.includes('new lump sum only') && assumption.includes('does not rebalance')));
});

test('displayed historical risk uses the full budget denominator after the emergency reserve', () => {
    const p = base({ emergencyReserve: 50000 }), h = history(stock), analysis = analyzeHistory(h);
    const candidate: AllocationCandidate = { instrument: stock, sector: stock.sector, assetType: 'equity', verified: true,
        annualVolatility: analysis.annualizedVolatility, maxDrawdown: analysis.maxDrawdown, observations: analysis.observations,
        asOf: analysis.lastDate, riskCurrency: 'USD', returns: h.bars.slice(1).map((bar, i) => ({ date: h.bars[i].date + '/' + bar.date, value: bar.close / h.bars[i].close - 1 })) };
    const allocation = allocatePlan({ amount: 50000, baseCurrency: 'USD', residenceCountry: 'US', horizonMonths: 120, goal: 'growth',
        principalNeededAtHorizon: false, maxVolatility: 30, maxLoss: 40, maxPositionWeight: .25, maxSectorWeight: .5 }, [candidate], { now: NOW });
    const plan = composePersonalizedPlan('scaled', p, allocation, new Map([[instrumentKey(stock), quote(stock).data!]]), true, { now: NOW });
    assert.ok(allocation.estimatedVolatility !== null); assert.equal(plan.estimatedVolatility, allocation.estimatedVolatility * .5);
    assert.equal(details(plan).totalBudgetRisk.observedVolatilityUpperBound, allocation.observedVolatilityUpperBound * .5);
    assert.ok(plan.checks.find(c => c.name === 'Observed risk sizing')?.detail.includes('total budget'));
    assert.equal(plan.allocations.reduce((sum, row) => sum + Math.round(row.amount * 100), 0), 10000000);
    assert.equal(plan.allocations.find(row => row.symbol)?.weightPercent, 12.5);
});

test('fractional cents are rejected while cent-precise split budgets conserve every cent', async () => {
    const app = service();
    for (const patch of [{ amount: 100.001 }, { emergencyReserve: .001 }, { monthlyContribution: .001 }])
        await assert.rejects(() => app.build('owner', 'bad-cents', { ...base(), ...patch }), /currency decimals/);
    const plan = await app.build('owner', 'cents', base({ amount: 100.01, emergencyReserve: 50.02 }));
    assert.equal(plan.totalAllocated, 100.01); assert.equal(plan.unallocated, 0);
    assert.equal(plan.allocations.reduce((sum, row) => sum + Math.round(row.amount * 100), 0), 10001);
    assert.equal(plan.allocations.find(row => row.id === 'emergency-reserve')?.amount, 50.02);
});

test('quotes load only for allocated instruments after historical eligibility, never as a data substitute', async () => {
    const requests: string[] = [];
    const app = service({ universe: () => [stock, other], history: async (_user, i) => {
        requests.push('history:' + i.symbol); return result(history(i, i.symbol === stock.symbol ? 400 : 100));
    }, quote: async (_user, i) => { requests.push('quote:' + i.symbol); return quote(i); } });
    const plan = await app.build('owner', 'quotes', base());
    assert.ok(plan.allocations.some(row => row.symbol === stock.symbol)); assert.equal(plan.allocations.some(row => row.symbol === other.symbol), false);
    assert.deepEqual(requests, ['history:TEST', 'history:SECOND', 'quote:TEST']);
    assert.equal(plan.allocations.find(row => row.symbol)?.priceCurrency, 'USD');
});

test('actual aligned FX enables foreign candidates and preserves both original provenance records without keys', async () => {
    let fxRequests = 0, quotes = 0;
    const fxInstrument: InstrumentRef = { symbol: 'USD/INR', providerSymbol: 'USD/INR', market: 'US', currency: 'INR' };
    const app = service({ universe: () => [stock, other], fxHistory: async (_user, listing, baseCurrency) => {
        fxRequests++; assert.equal(listing, 'USD'); assert.equal(baseCurrency, 'INR');
        return result(history(fxInstrument, 400, true), 'INR');
    }, quote: async (_user, i) => { quotes++; return quote(i); } });
    const plan = await app.build('owner', 'foreign', base({ baseCurrency: 'INR', residenceCountry: 'India', allowForeign: true }));
    assert.ok(plan.allocations.some(row => row.symbol)); assert.equal(fxRequests, 1); assert.equal(quotes, 2);
    assert.ok(plan.allocations.filter(row => row.symbol).every(row => row.currency === 'INR' && row.priceCurrency === 'USD' && row.units === null));
    const metadata = details(plan).sourceMetadata;
    assert.equal(metadata.length, 2); assert.equal(metadata[0].stock.provenance.currency, 'USD');
    assert.equal(metadata[0].fx.provenance.currency, 'INR'); assert.equal(metadata[0].fxConversion.coverage.eligibleForRisk, true);
    assert.equal(metadata[0].analysis.observations, 400); assert.equal(JSON.stringify(plan).includes('private-query-key'), false);
});

test('missing or mismatched observed FX excludes a foreign candidate and preserves budget as a reserve', async () => {
    for (const wrongPair of [false, true]) {
        let quoteRequests = 0;
        const app = service({ fxHistory: async () => wrongPair ? result(history({ symbol: 'EUR/INR', providerSymbol: 'EUR/INR', market: 'US', currency: 'INR' }, 400, true), 'INR') : result<MarketHistory>(null, 'INR', 'unavailable'),
            quote: async (_user, i) => { quoteRequests++; return quote(i); } });
        const plan = await app.build('owner', 'foreign-missing', base({ baseCurrency: 'INR', residenceCountry: 'India', allowForeign: true }));
        assert.equal(plan.allocations.some(row => row.symbol), false); assert.equal(plan.totalAllocated, 100000);
        assert.equal(plan.status, 'needs_data'); assert.equal(quoteRequests, 0);
        assert.equal(details(plan).sourceMetadata[0].eligibleForRisk, false);
    }
});

test('raw, stale and insufficient stock histories cannot qualify and do not trigger quote calls', async () => {
    for (const mode of ['raw', 'stale', 'short'] as const) {
        let quoteRequests = 0;
        const app = service({ history: async (_user, i) => {
            const h = history(i, mode === 'short' ? 100 : 400);
            if (mode === 'raw') h.adjustment = 'raw';
            if (mode === 'stale') h.bars = h.bars.map(bar => ({ ...bar, date: new Date(Date.parse(bar.date) - 60 * 86400000).toISOString().slice(0, 10) }));
            return result(h);
        }, quote: async (_user, i) => { quoteRequests++; return quote(i); } });
        const plan = await app.build('owner', mode, base());
        assert.equal(plan.status, 'needs_data'); assert.equal(plan.allocations.some(row => row.symbol), false); assert.equal(quoteRequests, 0);
    }
});

test('disabled foreign access avoids provider calls and contradictory source currencies fail closed', async () => {
    let requests = 0;
    const blocked = await service({ history: async () => { requests++; throw Error('Disabled foreign source'); } })
        .build('owner', 'foreign-disabled', base({ baseCurrency: 'INR', residenceCountry: 'India', allowForeign: false }));
    assert.equal(requests, 0); assert.equal(blocked.status, 'conditional'); assert.equal(blocked.allocations.some(row => row.symbol), false);
    const wrong = await service({ history: async (_user, i) => { const h = history(i); h.currency = 'INR'; return result(h, 'INR'); } })
        .build('owner', 'bad-currency', base({ baseCurrency: 'INR', residenceCountry: 'India', allowForeign: true }));
    assert.equal(wrong.allocations.some(row => row.symbol), false); assert.equal(wrong.status, 'needs_data');
});

test('stale quotes cannot create current units and future quote observations are withheld', async () => {
    for (const future of [false, true]) {
        const plan = await service({ quote: async (_user, i) => {
            const q = quote(i); q.data!.asOf = new Date(NOW.getTime() + (future ? 10 : -10) * 86400000).toISOString(); return q;
        } }).build('owner', 'quote-date', base());
        const allocated = plan.allocations.find(row => row.symbol)!;
        assert.equal(allocated.units, null); assert.equal(allocated.price, future ? null : 100);
    }
});

function reviewReport(input: ResearchAgentInput, status: StructuredResearchReport['status']): StructuredResearchReport {
    return { id: 'model-contract-report', status, startedAt: NOW.toISOString(), completedAt: NOW.toISOString(), input,
        plan: [], findings: [], risks: [], unansweredQuestions: [], stages: [], evidence: [], events: [],
        receipts: [{ id: 'actual-response-receipt-fixture', role: 'planner', provider: 'nvidia', requestedModel: 'nvidia/fixture', responseModel: 'nvidia/fixture',
            startedAt: NOW.toISOString(), latencyMs: 10, inputTokens: 30, outputTokens: 20, reasoningTokens: null, reportedCostUsd: null, requestId: 'fixture-request', status: status === 'failed' ? 'failed' : 'completed' }],
        budget: { modelCalls: 1, toolCalls: 0, knownTokens: 50, unknownUsageCalls: 0 }, limitations: [],
        ...(status === 'failed' ? { error: { code: 'provider_failure', message: 'The optional model request failed.' } } : {}) };
}
test('configured optional AI reviews cite computed plan and policy; historical memory cannot replace current evidence', async () => {
    let modelRuns = 0;
    const app = service({ getAISettings: async () => settings(true), recallMemory: async () => ({ context: 'A past user decision needs revalidation.', reused: true, count: 1 }),
        runAgents: async (input, options) => {
            modelRuns++; assert.equal(input.kind, 'plan'); assert.deepEqual(input.symbols, []);
            assert.ok(input.portfolioContext?.includes('Historical decision context only'));
            assert.deepEqual(options.seedEvidence?.map(e => e.kind), ['mandate', 'policy']);
            assert.ok(options.seedEvidence?.every(e => e.asOf === NOW.toISOString()));
            const content = options.seedEvidence![1].content as Record<string, any>;
            assert.ok(content.methodology.every((reference: { url: string }) => reference.url.startsWith('https://')));
            content.allocations[0].amount = 999999999; // No reference to the computed allocation is shared.
            return reviewReport(input, 'completed');
        } });
    const plan = await app.build('owner', 'cash-review', base({ emergencyReserve: 100000 }));
    assert.equal(modelRuns, 1); assert.equal(plan.totalAllocated, 100000); assert.equal(plan.allocations[0].amount, 100000);
    assert.equal(plan.research?.status, 'completed'); assert.equal(details(plan).aiReview.status, 'completed');
});

test('an unavailable or failed optional AI review never discards a valid cash plan or its returned usage receipts', async () => {
    for (const throws of [false, true]) {
        const app = service({ getAISettings: async () => settings(true), runAgents: async input => {
            if (throws) throw Error('Private upstream detail must not leak'); return reviewReport(input, 'failed');
        } });
        const plan = await app.build('owner', 'failed-review', base({ goal: 'specific_purchase', horizonMonths: 12 }));
        assert.equal(plan.totalAllocated, 100000); assert.equal(plan.status, 'conditional'); assert.equal(details(plan).aiReview.status, 'failed');
        if (!throws) assert.equal(plan.research?.receipts.length, 1);
        assert.equal(JSON.stringify(plan).includes('Private upstream detail'), false);
    }
});
test('cash-only plans do not imply measured covariance, zero-loss stress results or stock-analysis next steps',async()=>{
 const plan=await service().build('owner','cash-risk-copy',base({goal:'specific_purchase',horizonMonths:24,includeDeposits:false}));
 assert.equal(plan.estimatedVolatility,null);assert.equal(plan.stressLoss,null);assert.deepEqual(plan.scenarios,[]);
 assert.equal(plan.assumptions.some(a=>a.includes('Historical sample covariance')||a.includes('inverse-volatility')||a.startsWith('Displayed observed risk')),false);
 assert.ok(plan.assumptions.some(a=>a.includes('No stock history, portfolio covariance or measured reserve volatility was calculated')));
 assert.ok(plan.nextSteps.every(step=>!step.includes('counterargument')));
 assert.ok(plan.nextSteps.some(step=>step.includes('accessibility')));
 assert.equal(details(plan).totalBudgetRisk.observedVolatilityUpperBound,null);
 assert.match(details(plan).volatilityMethod,/No adjusted-history/);
});
