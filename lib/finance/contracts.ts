import { z } from 'zod';
import { markets, type Market } from '../contracts';
export const providerIds = ['finnhub', 'twelvedata', 'alphavantage'] as const;
export type MarketProvider = typeof providerIds[number];
export type Adjustment = 'raw' | 'split_adjusted' | 'split_dividend_adjusted' | 'unknown';
export type DataStatus = 'ok' | 'partial' | 'unavailable' | 'rate_limited' | 'unauthorized' | 'unsupported' | 'invalid_data';
export interface InstrumentRef {
    symbol: string;
    market: Market;
    exchange?: string;
    currency?: string;
    providerSymbol?: string;
    name?: string;
}
export interface DataProvenance {
    provider: MarketProvider | 'SEC' | 'user';
    fetchedAt: string;
    asOf: string | null;
    sourceUrl: string;
    currency: string | null;
    timezone: string | null;
    adjustment: Adjustment;
    delay: 'real_time' | 'delayed' | 'end_of_day' | 'unknown';
}
export interface ProviderResult<T> {
    status: DataStatus;
    data: T | null;
    provenance: DataProvenance;
    warnings: string[];
    retryAfterSeconds?: number;
    cached?: boolean;
}
export interface MarketQuote {
    instrument: InstrumentRef;
    price: number;
    previousClose: number | null;
    change: number | null;
    changePercent: number | null;
    asOf: string;
    currency: string | null;
}
export interface PriceBar {
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    volume: number | null;
}
export interface MarketHistory {
    instrument: InstrumentRef;
    bars: PriceBar[];
    interval: '1day';
    timezone: string | null;
    currency: string | null;
    adjustment: Adjustment;
}
export interface FundamentalMetric {
    value: number | null;
    unit: 'ratio' | 'percent' | 'currency' | 'currency_millions' | 'shares';
    period: string | null;
    note: string;
}
export interface CompanyFundamentals {
    instrument: InstrumentRef;
    name: string | null;
    sector: string | null;
    industry: string | null;
    currency: string | null;
    fiscalDate: string | null;
    metrics: {
        pe: FundamentalMetric;
        priceToBook: FundamentalMetric;
        roe: FundamentalMetric;
        operatingMargin: FundamentalMetric;
        debtToEquity: FundamentalMetric;
        revenueGrowth: FundamentalMetric;
        dividendYield: FundamentalMetric;
        marketCap: FundamentalMetric;
        eps: FundamentalMetric;
    };
}
export interface CompanyNews {
    id: string;
    headline: string;
    summary: string;
    url: string;
    source: string;
    publishedAt: string;
    instrument: InstrumentRef;
    sentiment?: {
        score: number;
        label: string;
        provider: string;
    };
}
export interface HistoryAnalysis {
    observations: number;
    firstDate: string | null;
    lastDate: string | null;
    annualizedReturn: number | null;
    annualizedVolatility: number | null;
    maxDrawdown: number | null;
    return1m: number | null;
    return3m: number | null;
    return6m: number | null;
    return1y: number | null;
    momentum12minus1: number | null;
    sma50: number | null;
    sma200: number | null;
    priceVsSma200: number | null;
    warnings: string[];
}
export interface FactorInput {
    instrument: InstrumentRef;
    history: HistoryAnalysis | null;
    fundamentals: CompanyFundamentals | null;
}
export interface FactorScore {
    instrument: InstrumentRef;
    score: number | null;
    components: {
        name: 'value' | 'quality' | 'momentum' | 'low_volatility';
        score: number | null;
        coverage: number;
        detail: string;
    }[];
    coverage: number;
    peerCount: number;
    warnings: string[];
}
const isoDate = z.string().refine(v => Number.isFinite(Date.parse(v)), 'A valid date/time is required');
export const instrumentSchema = z.object({ symbol: z.string().trim().min(1).max(80), market: z.enum(markets), exchange: z.string().trim().min(1).max(80).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), providerSymbol: z.string().trim().min(1).max(80).optional(), name: z.string().max(250).optional() });
export const tradeSchema = z.object({ id: z.string().min(1).max(160), instrument: instrumentSchema, side: z.enum(['BUY', 'SELL']), quantity: z.number().finite().positive().max(1e12), price: z.number().finite().nonnegative().max(1e12), fees: z.number().finite().nonnegative().max(1e12).default(0), currency: z.string().regex(/^[A-Z]{3}$/), executedAt: isoDate, note: z.string().max(2000).optional() });
export type PortfolioTrade = z.infer<typeof tradeSchema>;
export interface PositionValuation {
    instrument: InstrumentRef;
    currency: string;
    quantity: number;
    averageCost: number | null;
    costBasis: number;
    realizedPnl: number;
    unrealizedPnl: number | null;
    marketValue: number | null;
    price: number | null;
    priceAsOf: string | null;
    status: 'valued' | 'missing_quote' | 'stale_quote';
    warnings: string[];
}
export interface PortfolioSummary {
    costBasisMethod: 'fifo' | 'average';
    positions: PositionValuation[];
    byCurrency: {
        currency: string;
        costBasis: number;
        marketValue: number | null;
        realizedPnl: number;
        unrealizedPnl: number | null;
        pricedCostBasis: number;
        quoteCoverage: number;
        largestPositionWeight: number | null;
        herfindahl: number | null;
    }[];
    warnings: string[];
}
/** Each valuation is immediately before its external flow. Flows are deposits(+)/withdrawals(-), not internal trades. */
export interface PortfolioValuation {
    at: string;
    valueBeforeFlow: number;
    externalFlow: number;
    currency: string;
}
export interface TimeWeightedResult {
    returnPercent: number | null;
    periods: number;
    status: 'available' | 'insufficient_data';
    warnings: string[];
}
export const instrumentKey = (i: InstrumentRef) => `${i.market}:${i.exchange?.toUpperCase() ?? '?'}:${i.symbol.toUpperCase()}`;
