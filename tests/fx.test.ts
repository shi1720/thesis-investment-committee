import test from 'node:test';
import assert from 'node:assert/strict';
import { convertHistoryToBase } from '../lib/finance/fx';
import { analyzeHistory } from '../lib/finance/math';
import type { MarketHistory } from '../lib/finance/contracts';

// Deterministic test observations, not live prices or FX quotations.
function history(kind: 'stock' | 'direct' | 'inverse', count = 260): MarketHistory {
    const stock = kind === 'stock';
    return {
        instrument: { symbol: stock ? 'AAPL' : kind === 'direct' ? 'USD/INR' : 'INR/USD',
            providerSymbol: stock ? 'AAPL' : kind === 'direct' ? 'USD/INR' : 'INR/USD',
            market: 'US', currency: stock || kind === 'inverse' ? 'USD' : 'INR' },
        currency: stock || kind === 'inverse' ? 'USD' : 'INR', timezone: stock ? 'America/New_York' : 'UTC',
        adjustment: stock ? 'split_adjusted' : 'raw', interval: '1day',
        bars: Array.from({ length: count }, (_, i) => ({
            date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
            close: stock ? 100 + i / 10 : kind === 'direct' ? 80 + i / 100 : 1 / (80 + i / 100),
            open: null, high: null, low: null, volume: stock ? 5000 + i : null,
        })),
    };
}
const options = { baseCurrency: 'INR', quoteCurrency: 'USD', orientation: 'base_per_listing' } as const;

test('FX combines actual paired closes and preserves listing identity, adjustment and original volume', () => {
    const stock = history('stock'), fx = history('direct'), original = structuredClone(stock);
    const result = convertHistoryToBase(stock, fx, options);
    assert.ok(result.history); assert.equal(result.coverage.eligibleForRisk, true);
    assert.equal(result.history.currency, 'INR'); assert.equal(result.history.instrument.currency, 'USD');
    assert.equal(result.history.instrument.symbol, 'AAPL'); assert.equal(result.history.adjustment, 'split_adjusted');
    assert.equal(result.history.bars[0].close, 8000); assert.equal(result.history.bars[0].volume, 5000);
    assert.equal(result.history.bars[0].open, null); assert.equal(result.history.bars[0].high, null);
    assert.equal(result.coverage.stockCoverage, 1); assert.equal(result.coverage.matchedObservations, 260);
    assert.equal(result.coverage.sources?.fx.instrument.providerSymbol, 'USD/INR');
    assert.ok(result.warnings.some(w => w.includes('fixing conventions')));
    assert.ok(result.warnings.some(w => w.includes('future loss cap')));
    assert.deepEqual(stock, original);
    result.history.instrument.currency = 'TEST'; assert.equal(stock.instrument.currency, 'USD');
});

test('explicit inverse pair division agrees with the direct orientation without guessing rate units', () => {
    const direct = convertHistoryToBase(history('stock'), history('direct'), options);
    const inverse = convertHistoryToBase(history('stock'), history('inverse'), { ...options, orientation: 'listing_per_base' });
    assert.ok(direct.history); assert.ok(inverse.history);
    for (let i = 0; i < direct.history.bars.length; i++)
        assert.ok(Math.abs(direct.history.bars[i].close - inverse.history.bars[i].close) < 1e-8);
    assert.equal(convertHistoryToBase(history('stock'), history('inverse'), options).history, null);
});

test('mismatched pair, listing currency, rate currency and unknown currency fail closed', () => {
    for (const mutate of [
        (s: MarketHistory, _f: MarketHistory) => { s.currency = null; },
        (s: MarketHistory, _f: MarketHistory) => { s.instrument.currency = 'EUR'; },
        (_s: MarketHistory, f: MarketHistory) => { f.currency = 'USD'; },
        (_s: MarketHistory, f: MarketHistory) => { f.instrument.providerSymbol = 'EUR/INR'; },
        (_s: MarketHistory, f: MarketHistory) => { f.instrument.symbol = 'INR/USD'; },
    ]) {
        const stock = history('stock'), fx = history('direct'); mutate(stock, fx);
        const result = convertHistoryToBase(stock, fx, options);
        assert.equal(result.history, null); assert.equal(result.coverage.status, 'invalid_input');
    }
});

test('observations are never forward-filled and insufficient exact date intersections stay unavailable', () => {
    const stock = history('stock'), fx = history('direct'); fx.bars = fx.bars.slice(8);
    const result = convertHistoryToBase(stock, fx, options);
    assert.equal(result.history, null); assert.equal(result.coverage.matchedObservations, 252);
    assert.equal(result.coverage.firstDate, stock.bars[8].date); assert.equal(result.coverage.requiredObservations, 253);
    assert.equal(result.coverage.stockCoverage, 252 / 260);
    assert.equal(result.coverage.status, 'insufficient_data');
    const boundary = convertHistoryToBase(history('stock', 253), history('direct', 253), options);
    assert.ok(boundary.history); assert.equal(boundary.coverage.matchedObservations, 253);
    assert.equal(boundary.coverage.eligibleForRisk, true);
});

test('extra FX-only dates do not create stock sessions and boundary trimming preserves real intervals', () => {
    const stock = history('stock'), fx = history('direct', 270); stock.bars = stock.bars.slice(5);
    const result = convertHistoryToBase(stock, fx, options);
    assert.ok(result.history); assert.equal(result.history.bars.length, 255);
    assert.equal(result.coverage.stockCoverage, 1); assert.equal(result.coverage.fxCoverage, 255 / 270);
    assert.equal(result.history.bars[0].date, stock.bars[0].date);
});

test('an interior missing FX session cannot silently become an equal daily return interval', () => {
    const stock = history('stock'), fx = history('direct'); fx.bars.splice(100, 1);
    const result = convertHistoryToBase(stock, fx, options);
    assert.equal(result.coverage.matchedObservations, 259); assert.equal(result.history, null);
    assert.equal(result.coverage.interiorMissingStockSessions, 1);
    assert.equal(result.coverage.eligibleForRisk, false);
});

test('nonpositive, nonfinite, duplicate, impossible-date and overflowing source observations are rejected', () => {
    for (const invalid of [0, -1, NaN, Infinity]) {
        const fx = history('direct'); fx.bars[0].close = invalid;
        assert.equal(convertHistoryToBase(history('stock'), fx, options).history, null);
    }
    for (const date of ['2025-02-30', 'not-a-date']) {
        const fx = history('direct'); fx.bars[0].date = date;
        assert.equal(convertHistoryToBase(history('stock'), fx, options).history, null);
    }
    const repeated = history('direct'); repeated.bars[1].date = repeated.bars[0].date;
    assert.equal(convertHistoryToBase(history('stock'), repeated, options).history, null);
    const stock = history('stock'), fx = history('direct'); stock.bars[0].close = 1e308;
    assert.equal(convertHistoryToBase(stock, fx, options).history, null);
});

test('raw corporate-action convention is preserved and cannot be promoted into adjusted risk', () => {
    const stock = history('stock'); stock.adjustment = 'raw';
    const result = convertHistoryToBase(stock, history('direct'), options);
    assert.ok(result.history); assert.equal(result.history.adjustment, 'raw');
    assert.equal(result.coverage.eligibleForRisk, false);
    assert.equal(analyzeHistory(result.history).annualizedVolatility, null);
});

test('joint long calendar gaps still withhold annualized risk and unknown currency codes are not accepted', () => {
    const stock = history('stock'), fx = history('direct');
    for (const source of [stock, fx]) for (let i = 130; i < source.bars.length; i++)
        source.bars[i].date = new Date(Date.parse(source.bars[i].date) + 20 * 86400000).toISOString().slice(0, 10);
    const result = convertHistoryToBase(stock, fx, options);
    assert.ok(result.history); assert.equal(result.coverage.eligibleForRisk, false);
    assert.equal(analyzeHistory(result.history).annualizedVolatility, null);
    assert.equal(convertHistoryToBase(history('stock'), history('direct'), { ...options, baseCurrency: 'ZZZ' }).history, null);
});
