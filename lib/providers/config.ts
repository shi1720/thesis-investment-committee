import type { ProviderStatus } from '../contracts';

/** Server-only configuration. Never serialize this object to the browser. */
export interface ProviderEnv {
  NIGHTSHIFT_BASE_URL?: string;
  NIGHTSHIFT_API_KEY?: string;
  NIGHTSHIFT_MODEL?: string;
  NIGHTSHIFT_AUDITOR_MODEL?: string;
  NIGHTSHIFT_TIMEOUT_MS?: string;
  ZETARIS_BASE_URL?: string;
  ZETARIS_API_KEY?: string;
  ZETARIS_ORG_ID?: string;
  ZETARIS_ENGINE_ID?: string;
  ZETARIS_API_MODE?: string;
  ZETARIS_STOCKS_VIEW?: string;
  ZETARIS_ALLOW_SAMPLE_DATA?: string;
}

export function getProviderStatuses(env: ProviderEnv): ProviderStatus[] {
  return [
    { name: 'Zetaris', status: env.ZETARIS_BASE_URL && env.ZETARIS_API_KEY && env.ZETARIS_ORG_ID ? 'configured' : 'unavailable', detail: env.ZETARIS_BASE_URL && env.ZETARIS_API_KEY && env.ZETARIS_ORG_ID ? 'Credentials configured. A successful data query is required to verify the connection.' : 'Connect your Zetaris instance, organization and read-only API token to research live data.' },
    { name: 'Meterless Nightshift', status: env.NIGHTSHIFT_BASE_URL && env.NIGHTSHIFT_API_KEY ? 'configured' : 'unavailable', detail: env.NIGHTSHIFT_BASE_URL && env.NIGHTSHIFT_API_KEY ? 'Runtime configured. Connection and resolved model are verified on each live run.' : 'Set a reachable Nightshift Runtime URL and its real proxy token.' },
    { name: 'Meterless H-MEM', status: 'verified', detail: 'Official pinned TypeScript engine runs locally: provenance, hybrid recall, correction supersession and audit ledger. No API key required.' },
    { name: 'NVIDIA Nemotron', status: 'unavailable', detail: 'Select a Nemotron route in Nightshift. A concrete Nemotron response model must appear in a live receipt before this integration is verified.' },
  ];
}

export class ProviderError extends Error {
  constructor(public readonly provider: 'Nightshift'|'Zetaris', public readonly code: 'configuration'|'unauthorized'|'unavailable'|'invalid_response'|'timeout', message: string, public readonly retryable = false) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Env-controlled URLs only: callers must never pass user-supplied URLs. */
export function serverUrl(value: string, provider: 'Nightshift'|'Zetaris'): URL {
  let parsed: URL;
  try { parsed = new URL(value.includes('://') ? value : `http://${value}`); }
  catch { throw new ProviderError(provider, 'configuration', `${provider} URL is invalid.`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !local)) {
    throw new ProviderError(provider, 'configuration', `${provider} requires HTTPS; HTTP is allowed only on loopback during local development.`);
  }
  parsed.hash = ''; parsed.search = '';
  return parsed;
}
