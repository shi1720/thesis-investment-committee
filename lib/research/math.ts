/** Quantities are percentages unless specified. 252 sessions is an explicit convention. */
export const TRADING_DAYS = 252;
export function round(value: number, digits = 2): number {
  const n = 10 ** digits;
  return Math.round((value + Number.EPSILON) * n) / n;
}
export interface PriceMetrics {
  annualReturn: number;
  annualVolatility: number;
  maxDrawdown: number;
  observations: number;
}
export function priceMetrics(prices: readonly number[]): PriceMetrics {
  if (prices.length < 61 || prices.length > 10000) throw new Error('At least 61 and at most 10,000 daily adjusted closing prices are required.');
  if (prices.some(p => !Number.isFinite(p) || p <= 0)) throw new Error('Daily adjusted closing prices must be finite and positive.');
  const returns = prices.slice(1).map((p, i) => p / prices[i] - 1);
  if (returns.some(r=>!Number.isFinite(r))) throw new Error('Daily adjusted return calculation overflowed.');
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  let peak = prices[0], maxDrawdown = 0;
  for (const price of prices) {
    peak = Math.max(peak, price);
    maxDrawdown = Math.max(maxDrawdown, (peak - price) / peak);
  }
  const result = {
    annualReturn: Math.expm1((Math.log(prices[prices.length - 1])-Math.log(prices[0])) * TRADING_DAYS / returns.length) * 100,
    annualVolatility: Math.sqrt(variance * TRADING_DAYS) * 100,
    maxDrawdown: maxDrawdown * 100,
    observations: returns.length,
  };
  if (!Number.isFinite(result.annualReturn) || !Number.isFinite(result.annualVolatility)) throw new Error('Price-derived annualized metrics must be finite.');
  return result;
}
/** Seeded fixture generator: these are fabricated demonstration prices, never market observations. */
export function syntheticPrices(seed: number, finalPrice: number, annualReturnPct: number, annualVolatilityPct: number, sessions = 504): number[] {
  let state = seed >>> 0;
  const rand = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return (state + 1) / 4294967297; };
  const raw = Array.from({ length: sessions }, (_, i) => {
    const z = Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
    // Correlated regimes make stress losses and drawdowns meaningfully distinct between fixtures.
    return z + 0.24 * Math.sin(i / 21 + seed) - (i > 220 && i < 245 ? 0.4 : 0);
  });
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const sd = Math.sqrt(raw.reduce((a, b) => a + (b - mean) ** 2, 0) / (raw.length - 1));
  const drift = Math.log1p(annualReturnPct / 100) / TRADING_DAYS;
  const scale = annualVolatilityPct / 100 / Math.sqrt(TRADING_DAYS);
  const prices = [finalPrice / ((1 + annualReturnPct / 100) ** (sessions / TRADING_DAYS))];
  for (const value of raw) prices.push(prices[prices.length - 1] * Math.exp(drift + scale * (value - mean) / sd));
  return prices.map(p => round(p, 6));
}
export function hashText(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
