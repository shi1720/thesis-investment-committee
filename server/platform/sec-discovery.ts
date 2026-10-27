import type { InstrumentRef } from '../../lib/finance/contracts';
let cached: {
    expires: number;
    data: {
        cik: number;
        title: string;
        ticker: string;
        exchange?: string;
    }[];
} | null = null;
/** SEC issuer discovery, not a price feed. Endpoint fixed to the official public issuer list. */
export async function searchSecIssuers(query: string, options: {
    contact: string;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    limit?: number;
}): Promise<{
    source: string;
    retrievedAt: string;
    asOf: null;
    data: (InstrumentRef & {
        cik: string;
    })[];
    warnings: string[];
}> {
    const source = 'https://www.sec.gov/files/company_tickers_exchange.json';
    const q = query.trim().toUpperCase();
    if (!q || q.length > 100)
        throw new Error('SEC search query must contain one to one hundred characters.');
    if (!/[^\s@]+@[^\s@]+\.[^\s@]+/.test(options.contact) || /[\r\n]/.test(options.contact))
        throw new Error('SEC requests require an operator contact email.');
    if (!cached || cached.expires < Date.now()) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const timeout = setTimeout(abort, 10000);
        if (options.signal?.aborted)
            controller.abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        try {
            const response = await (options.fetcher ?? fetch)(source, { headers: { 'User-Agent': 'Thesis research contact ' + options.contact, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
            if (!response.ok)
                throw new Error('SEC issuer discovery unavailable; do not retry around rate/access controls.');
            const reader = response.body?.getReader();
            if (!reader)
                throw new Error('SEC issuer metadata body missing.');
            const chunks: Uint8Array[] = [];
            let length = 0;
            try {
                while (true) {
                    const v = await reader.read();
                    if (v.done)
                        break;
                    length += v.value.length;
                    if (length > 2000000) {
                        await reader.cancel();
                        throw new Error('SEC issuer metadata exceeded size limit.');
                    }
                    chunks.push(v.value);
                }
            }
            finally {
                reader.releaseLock();
            }
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
            }
            const out = JSON.parse(new TextDecoder().decode(bytes));
            if (!Array.isArray(out.fields) || !Array.isArray(out.data))
                throw new Error('SEC issuer metadata contract changed.');
            const fields: unknown[] = out.fields;
            const ci = fields.indexOf('cik'), ti = fields.indexOf('ticker'), na = fields.indexOf('name'), ex = fields.indexOf('exchange');
            if (Math.min(ci, ti, na) < 0)
                throw new Error('SEC issuer metadata has missing fields.');
            cached = { expires: Date.now() + 86400000, data: out.data.map((row: unknown) => { if (!Array.isArray(row))
                    throw new Error('SEC issuer metadata row invalid.'); return { cik: Number(row[ci]), ticker: String(row[ti]), title: String(row[na]), exchange: ex >= 0 && typeof row[ex] === 'string' ? row[ex] : undefined }; }).filter((r: {
                    cik: number;
                }) => Number.isFinite(r.cik)) };
        }
        finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', abort);
        }
    }
    return { source, retrievedAt: new Date().toISOString(), asOf: null, data: cached.data.filter(r => r.ticker.includes(q) || r.title.toUpperCase().includes(q)).slice(0, Math.max(1, Math.min(options.limit ?? 20, 50))).map(r => ({ symbol: r.ticker, providerSymbol: r.ticker, name: r.title, market: 'US', exchange: r.exchange, cik: String(r.cik).padStart(10, '0') })), warnings: ['SEC issuer metadata provides company identity and listing exchange, not current quotes, currency, factor scores or vendor entitlements.', 'SEC does not publish an observation date in this file; retrieval date is distinct from source as-of.'] };
}
