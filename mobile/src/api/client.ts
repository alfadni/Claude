import { resolveApiUrl } from './config';
import type { ForecastResponse, ModelName } from './types';
import { InvalidForecastError, parseForecast } from './validate';

export type ForecastErrorKind =
  | 'offline' // request never reached the server
  | 'timeout'
  | 'unavailable' // 503: server up, price feed down
  | 'server' // other 5xx
  | 'client' // 4xx: a bug on our side
  | 'invalid' // response failed validation
  | 'config'; // no usable API URL in this build

export class ForecastError extends Error {
  constructor(
    public readonly kind: ForecastErrorKind,
    message: string,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ForecastError';
  }
}

/** User-facing copy per failure kind. Server text is not shown verbatim. */
export function describeError(e: ForecastError): string {
  switch (e.kind) {
    case 'offline':
      return "You're offline or the forecast service can't be reached.";
    case 'timeout':
      return 'The forecast service took too long to respond.';
    case 'unavailable':
      return 'Price data is temporarily unavailable.';
    case 'server':
      return 'The forecast service had a problem.';
    case 'client':
      return 'This app sent a request the service rejected. Please update the app.';
    case 'invalid':
      return 'The forecast came back incomplete, so it is not shown.';
    case 'config':
      return 'This build is not configured with a forecast service.';
  }
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Shown until a response (which carries the server's own wording) arrives. */
export const FALLBACK_DISCLAIMER =
  'Statistical projection from past prices only. Not financial advice. Crypto prices regularly move outside any forecast band.';

export interface FetchForecastOptions {
  horizon: number;
  model?: ModelName;
  signal?: AbortSignal;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch and validate a forecast. Throws ForecastError for every failure
 * except a caller-initiated abort, which rethrows the AbortError so callers
 * can ignore superseded requests.
 */
export async function fetchForecast({
  horizon,
  model = 'ensemble',
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  baseUrl,
  fetchImpl = fetch,
}: FetchForecastOptions): Promise<ForecastResponse> {
  let url: string;
  try {
    url = `${baseUrl ?? resolveApiUrl()}/v1/forecast?horizon=${horizon}&model=${model}`;
  } catch (e) {
    throw new ForecastError('config', (e as Error).message);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (e) {
      if (timedOut) throw new ForecastError('timeout', `No response within ${timeoutMs} ms`);
      if (signal?.aborted) throw e;
      throw new ForecastError('offline', (e as Error).message);
    }

    if (!res.ok) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const kind = res.status === 503 ? 'unavailable' : res.status >= 500 ? 'server' : 'client';
      throw new ForecastError(
        kind,
        `HTTP ${res.status}`,
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (e) {
      if (timedOut) throw new ForecastError('timeout', `No response within ${timeoutMs} ms`);
      if (signal?.aborted) throw e;
      throw new ForecastError('invalid', 'Response is not JSON');
    }
    try {
      return parseForecast(body, { horizon, model });
    } catch (e) {
      if (e instanceof InvalidForecastError) throw new ForecastError('invalid', e.reason);
      throw e;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
