import type { Adjustment, InstrumentRef, MarketHistory, PriceBar } from './contracts';

export interface FXConversionOptions {
    /** Destination currency of the investor's budget, such as INR. */
    baseCurrency: string;
    /** Original currency of the stock listing, such as USD. */
    quoteCurrency: string;
    orientation: 'base_per_listing' | 'listing_per_base';
}

interface HistorySourceMetadata {
    instrument: InstrumentRef;
    priceCurrency: string | null;
    timezone: string | null;
    adjustment: Adjustment;
    firstDate: string | null;
    lastDate: string | null;
    observations: number;
}

export interface FXCoverage {
    status: 'ready' | 'insufficient_data' | 'invalid_input';
    stockObservations: number;
    fxObservations: number;
    matchedObservations: number;
    stockCoverage: number;
    fxCoverage: number;
    interiorMissingStockSessions: number;
    firstDate: string | null;
    lastDate: string | null;
    requiredObservations: 253;
    eligibleForRisk: boolean;
    baseCurrency: string;
    quoteCurrency: string;
    orientation: FXConversionOptions['orientation'];
    sources?: { stock: HistorySourceMetadata; fx: HistorySourceMetadata };
}

export interface FXConversionResult {
    history: MarketHistory | null;
    warnings: string[];
    coverage: FXCoverage;
}

const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'));
const currencyCode = (value: unknown): value is string =>
    typeof value === 'string' && /^[A-Z]{3}$/.test(value) && supportedCurrencies.has(value);
const validDate = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};
function validHistory(value: MarketHistory): boolean {
    if (!value || value.interval !== '1day' || !value.instrument ||
        typeof value.instrument.symbol !== 'string' || !value.instrument.symbol.trim() ||
        !['raw', 'unknown', 'split_adjusted', 'split_dividend_adjusted'].includes(value.adjustment) ||
        !Array.isArray(value.bars) || value.bars.length > 10000) return false;
    return value.bars.every((bar, index) => bar && validDate(bar.date) &&
        Number.isFinite(bar.close) && bar.close > 0 &&
        (index === 0 || bar.date > value.bars[index - 1].date) &&
        (bar.volume === null || (Number.isFinite(bar.volume) && bar.volume >= 0)));
}
const sourceMetadata = (history: MarketHistory): HistorySourceMetadata => ({
    instrument: { ...history.instrument }, priceCurrency: history.currency,
    timezone: history.timezone, adjustment: history.adjustment,
    firstDate: history.bars[0]?.date ?? null,
    lastDate: history.bars.at(-1)?.date ?? null,
    observations: history.bars.length,
});

/**
 * A historical marked-value proxy, never an executable FX quote or future loss cap.
 * Exact observed calendar-date intersection only. The caller must retain both
 * ProviderResult provenance envelopes; bare MarketHistory does not contain URLs,
 * provider names, fetch times or fixing-time attestations.
 */
export function convertHistoryToBase(
    stock: MarketHistory,
    fx: MarketHistory,
    options: FXConversionOptions,
): FXConversionResult {
    const coverage: FXCoverage = {
        status: 'invalid_input', stockObservations: Array.isArray(stock?.bars) ? stock.bars.length : 0,
        fxObservations: Array.isArray(fx?.bars) ? fx.bars.length : 0,
        matchedObservations: 0, stockCoverage: 0, fxCoverage: 0,
        interiorMissingStockSessions: 0, firstDate: null, lastDate: null,
        requiredObservations: 253, eligibleForRisk: false,
        baseCurrency: options?.baseCurrency, quoteCurrency: options?.quoteCurrency,
        orientation: options?.orientation,
    };
    const warnings = [
        'Historical stock and FX closes are paired by the exact supplied calendar date. No rate is forward-filled or interpolated.',
        'Stock and FX close times, market calendars and fixing conventions can differ even on matching dates. This is a daily marked-value proxy, not a synchronized executable quote.',
        'Retain both original provider provenance envelopes, source dates, timezones and FX pair orientation. This function cannot attest provider identity from bare price histories.',
        'Converted history excludes execution spreads, conversion fees, taxes and lot rules. Historical risk cannot establish or guarantee a future loss cap.',
    ];
    const fail = (message: string, status: FXCoverage['status'] = 'invalid_input'): FXConversionResult => {
        coverage.status = status;
        return { history: null, warnings: [...warnings, message], coverage };
    };
    if (!options || !currencyCode(options.baseCurrency) || !currencyCode(options.quoteCurrency) ||
        !['base_per_listing', 'listing_per_base'].includes(options.orientation))
        return fail('Valid ISO-style currency codes and an explicit FX orientation are required.');
    if (options.baseCurrency === options.quoteCurrency)
        return fail('Listing and budget currencies are identical. Use the original history without inventing an FX series.');
    if (!validHistory(stock) || !validHistory(fx))
        return fail('Each source must contain unique ascending daily dates and finite strictly positive observed closes. Invalid observations are not silently dropped.');
    coverage.sources = { stock: sourceMetadata(stock), fx: sourceMetadata(fx) };
    if (stock.currency !== options.quoteCurrency ||
        (stock.instrument.currency !== undefined && stock.instrument.currency !== options.quoteCurrency))
        return fail('The stock history and listing currency must agree with the requested original currency.');
    const expectedPair = options.orientation === 'base_per_listing'
        ? `${options.quoteCurrency}/${options.baseCurrency}`
        : `${options.baseCurrency}/${options.quoteCurrency}`;
    const expectedRateCurrency = options.orientation === 'base_per_listing'
        ? options.baseCurrency : options.quoteCurrency;
    const pair = fx.instrument.providerSymbol ?? fx.instrument.symbol;
    if (pair !== expectedPair ||
        (/^[A-Z]{3}\/[A-Z]{3}$/.test(fx.instrument.symbol) && fx.instrument.symbol !== expectedPair))
        return fail(`The verified FX pair must be exactly ${expectedPair} for the selected orientation.`);
    if (fx.currency !== expectedRateCurrency ||
        (fx.instrument.currency !== undefined && fx.instrument.currency !== expectedRateCurrency))
        return fail('The FX history currency does not match the rate units implied by the verified pair.');

    const rates = new Map(fx.bars.map(bar => [bar.date, bar.close]));
    const bars: PriceBar[] = [];
    for (const bar of stock.bars) {
        const rate = rates.get(bar.date);
        if (rate === undefined) continue;
        const close = options.orientation === 'base_per_listing' ? bar.close * rate : bar.close / rate;
        if (!Number.isFinite(close) || close <= 0)
            return fail('Currency conversion overflowed or underflowed. No invalid converted close was retained.');
        // Independent daily extrema cannot yield a valid combined intraday OHLC.
        bars.push({ date: bar.date, open: null, high: null, low: null, close, volume: bar.volume });
    }
    coverage.matchedObservations = bars.length;
    coverage.stockCoverage = stock.bars.length ? bars.length / stock.bars.length : 0;
    coverage.fxCoverage = fx.bars.length ? bars.length / fx.bars.length : 0;
    coverage.firstDate = bars[0]?.date ?? null;
    coverage.lastDate = bars.at(-1)?.date ?? null;
    if (bars.length < coverage.requiredObservations)
        return fail('At least 253 exact common daily observations are required before converted risk history is available.', 'insufficient_data');
    const missing = stock.bars.filter(bar => bar.date >= coverage.firstDate! &&
        bar.date <= coverage.lastDate! && !rates.has(bar.date)).length;
    coverage.interiorMissingStockSessions = missing;
    if (missing)
        return fail('FX is missing on an interior stock session. Dropping that session creates unequal return intervals, so annualized converted risk is withheld.', 'insufficient_data');
    if (coverage.stockCoverage < 1)
        warnings.push('Unmatched stock dates at the boundaries are omitted. Source endpoints and the exact retained date window remain visible in coverage.');
    warnings.push('Converted OHLC values are withheld because independently timed daily extrema cannot be multiplied or divided into genuine intraday extrema. Original stock share volume is retained.');
    if (stock.timezone !== fx.timezone || !stock.timezone || !fx.timezone)
        warnings.push('Source timezones differ or are unknown. Matching date labels do not attest matching close instants.');
    const adjusted = stock.adjustment === 'split_adjusted' || stock.adjustment === 'split_dividend_adjusted';
    const longGap = bars.some((bar, index) => index > 0 &&
        Date.parse(bar.date) - Date.parse(bars[index - 1].date) > 7 * 86400000);
    if (!adjusted)
        warnings.push('Stock corporate-action adjustment is raw or unknown. It is preserved and cannot support adjusted risk estimates.');
    if (longGap)
        warnings.push('The matched series has a gap longer than seven calendar days. Daily annualized risk estimates must remain unavailable.');
    coverage.eligibleForRisk = adjusted && !longGap;
    coverage.status = 'ready';
    return {
        history: {
            instrument: { ...stock.instrument }, bars, interval: '1day', timezone: stock.timezone,
            currency: options.baseCurrency, adjustment: stock.adjustment,
        },
        warnings,
        coverage,
    };
}
