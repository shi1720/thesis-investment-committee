/** Bounded process-local cache. Persistent/global provider quotas must additionally be enforced by the owning server route. */
export class MarketDataCache {
    private entries = new Map<string, {
        expires: number;
        value: unknown;
    }>();
    private pending = new Map<string, Promise<unknown>>();
    private usage = new Map<string, {
        minute: number;
        minuteCount: number;
        day: number;
        dayCount: number;
        blockedUntil: number;
    }>();
    constructor(private maxEntries = 128, private now: () => number = Date.now) { }
    async load<T>(key: string, ttlMs: number, loader: () => Promise<T>, cacheable: (value: T) => boolean = () => true): Promise<{
        value: T;
        cached: boolean;
    }> {
        const existing = this.entries.get(key);
        if (existing && existing.expires > this.now())
            return { value: structuredClone(existing.value as T), cached: true };
        if (existing)
            this.entries.delete(key);
        const pending = this.pending.get(key);
        if (pending)
            return { value: structuredClone(await pending as T), cached: true };
        if (this.pending.size >= 64)
            throw new Error('Market-data concurrency limit reached.');
        const promise = loader();
        this.pending.set(key, promise);
        try {
            const value = await promise;
            if (cacheable(value)) {
                this.entries.set(key, { expires: this.now() + Math.max(0, ttlMs), value: structuredClone(value) });
                while (this.entries.size > this.maxEntries)
                    this.entries.delete(this.entries.keys().next().value!);
            }
            return { value, cached: false };
        }
        finally {
            this.pending.delete(key);
        }
    }
    reserve(key: string, limits: {
        minute: number;
        day: number;
    }, cost = 1): {
        allowed: boolean;
        retryAfterSeconds: number;
    } {
        const now = this.now(), minute = Math.floor(now / 60000), day = Math.floor(now / 86400000);
        const u = this.usage.get(key) ?? { minute, minuteCount: 0, day, dayCount: 0, blockedUntil: 0 };
        if (u.minute !== minute) {
            u.minute = minute;
            u.minuteCount = 0;
        }
        if (u.day !== day) {
            u.day = day;
            u.dayCount = 0;
        }
        const retry = u.blockedUntil > now ? Math.ceil((u.blockedUntil - now) / 1000) : u.dayCount + cost > limits.day ? Math.ceil(((day + 1) * 86400000 - now) / 1000) : u.minuteCount + cost > limits.minute ? Math.ceil(((minute + 1) * 60000 - now) / 1000) : 0;
        if (!retry) {
            u.minuteCount += cost;
            u.dayCount += cost;
        }
        this.usage.set(key, u);
        if (this.usage.size > 2048) {
            const oldest = this.usage.keys().next().value;
            if (oldest && oldest !== key)
                this.usage.delete(oldest);
        }
        return { allowed: retry === 0, retryAfterSeconds: retry };
    }
    block(key: string, seconds: number) { const now = this.now(); const u = this.usage.get(key) ?? { minute: Math.floor(now / 60000), minuteCount: 0, day: Math.floor(now / 86400000), dayCount: 0, blockedUntil: 0 }; u.blockedUntil = Math.max(u.blockedUntil, now + Math.max(1, Math.min(seconds, 86400)) * 1000); this.usage.set(key, u); }
    clear() { this.entries.clear(); this.pending.clear(); }
}
export const defaultMarketCache = new MarketDataCache();
