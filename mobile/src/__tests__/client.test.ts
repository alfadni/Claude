import { ForecastError, describeError, fetchForecast } from '@/api/client';
import { resolveApiUrl } from '@/api/config';
import { jsonResponse, makeForecast } from '@/test-utils/fixtures';

const BASE = 'https://api.example.test';

function call(fetchImpl: typeof fetch, extra: Partial<Parameters<typeof fetchForecast>[0]> = {}) {
  return fetchForecast({ horizon: 30, baseUrl: BASE, fetchImpl, ...extra });
}

async function expectKind(p: Promise<unknown>, kind: ForecastError['kind']) {
  const e = await p.then(
    () => null,
    (err) => err,
  );
  expect(e).toBeInstanceOf(ForecastError);
  expect(e.kind).toBe(kind);
  expect(describeError(e)).toEqual(expect.any(String));
  return e as ForecastError;
}

/** fetch that never settles until its signal aborts, like a hung connection. */
const hangingFetch = ((_: string, init: RequestInit) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
    );
  })) as unknown as typeof fetch;

describe('fetchForecast', () => {
  it('requests the right URL and returns validated data', async () => {
    const f = jest.fn(async () => jsonResponse(makeForecast())) as unknown as typeof fetch;
    const data = await call(f);
    expect(data.horizon_days).toBe(30);
    expect((f as jest.Mock).mock.calls[0][0]).toBe(`${BASE}/v1/forecast?horizon=30&model=ensemble`);
  });

  it('maps a network failure to offline', async () => {
    await expectKind(
      call(async () => {
        throw new TypeError('Network request failed');
      }),
      'offline',
    );
  });

  it('times out a hung request', async () => {
    await expectKind(call(hangingFetch, { timeoutMs: 20 }), 'timeout');
  });

  it('rethrows a caller abort instead of reporting an error', async () => {
    const controller = new AbortController();
    const p = call(hangingFetch, { signal: controller.signal, timeoutMs: 10_000 });
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps 503 to unavailable with Retry-After', async () => {
    const e = await expectKind(
      call(async () =>
        jsonResponse({ error: { code: 'upstream_unavailable' } }, 503, { 'Retry-After': '60' }),
      ),
      'unavailable',
    );
    expect(e.retryAfterSeconds).toBe(60);
  });

  it('maps other 5xx to server and 4xx to client', async () => {
    await expectKind(
      call(async () => jsonResponse({}, 500)),
      'server',
    );
    await expectKind(
      call(async () => jsonResponse({}, 422)),
      'client',
    );
  });

  it('maps a non-JSON body to invalid', async () => {
    const res = {
      ...jsonResponse(null),
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response;
    await expectKind(
      call(async () => res),
      'invalid',
    );
  });

  it('maps a payload that fails validation to invalid', async () => {
    const bad = { ...makeForecast(), forecast: [] };
    await expectKind(
      call(async () => jsonResponse(bad)),
      'invalid',
    );
  });

  it('reports a missing API URL as config, without calling fetch', async () => {
    const f = jest.fn() as unknown as typeof fetch;
    const prev = process.env.EXPO_PUBLIC_API_URL;
    const prevDev = (globalThis as any).__DEV__;
    delete process.env.EXPO_PUBLIC_API_URL;
    (globalThis as any).__DEV__ = false;
    try {
      await expectKind(fetchForecast({ horizon: 30, fetchImpl: f }), 'config');
      expect(f).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = prev;
      (globalThis as any).__DEV__ = prevDev;
    }
  });
});

describe('resolveApiUrl', () => {
  it('uses the env URL and strips trailing slashes', () => {
    expect(resolveApiUrl('https://api.example.com//', false, 'ios')).toBe('https://api.example.com');
  });

  it('falls back to the local server in development', () => {
    expect(resolveApiUrl('', true, 'ios')).toBe('http://localhost:8000');
    expect(resolveApiUrl('', true, 'android')).toBe('http://10.0.2.2:8000');
  });

  it('requires a URL and HTTPS in release builds', () => {
    expect(() => resolveApiUrl('', false, 'ios')).toThrow(/not set/);
    expect(() => resolveApiUrl('http://api.example.com', false, 'ios')).toThrow(/HTTPS/);
  });
});
