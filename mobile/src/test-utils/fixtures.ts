import type { ForecastResponse } from '@/api/types';

const DAY_MS = 86_400_000;

export function isoDay(offsetDays: number, from: Date = new Date()): string {
  const today = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return new Date(today + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** A self-consistent forecast payload whose last close is `asOfOffset` days from today. */
export function makeForecast({
  horizon = 30,
  model = 'ensemble',
  lastClose = 0.5,
  historyDays = 60,
  asOfOffset = 0,
  bandWidth = 0.04, // daily log-vol driving the bands
  ...overrides
}: Partial<ForecastResponse> & {
  horizon?: number;
  lastClose?: number;
  historyDays?: number;
  asOfOffset?: number;
  bandWidth?: number;
} = {}): ForecastResponse {
  const history = Array.from({ length: historyDays }, (_, i) => ({
    date: isoDay(asOfOffset - (historyDays - 1 - i)),
    close: lastClose * (1 + 0.1 * Math.sin(i / 7)),
  }));
  history[history.length - 1].close = lastClose;
  const z = { p05: -1.645, p25: -0.674, p50: 0, p75: 0.674, p95: 1.645 };
  const forecast = Array.from({ length: horizon }, (_, j) => {
    const s = bandWidth * Math.sqrt(j + 1);
    return {
      date: isoDay(asOfOffset + j + 1),
      p05: lastClose * Math.exp(z.p05 * s),
      p25: lastClose * Math.exp(z.p25 * s),
      p50: lastClose,
      p75: lastClose * Math.exp(z.p75 * s),
      p95: lastClose * Math.exp(z.p95 * s),
    };
  });
  const end = forecast[forecast.length - 1];
  return {
    asset: 'XRP',
    currency: 'USD',
    model: model as ForecastResponse['model'],
    horizon_days: horizon,
    data_as_of: history[history.length - 1].date,
    last_close: lastClose,
    history,
    forecast,
    summary: { ...end, median_change_pct: 0 },
    backtest: {
      horizon_days: 30,
      models: [
        { model: 'ensemble', mape: 0.12, coverage_90: 0.92, n: 12 },
        { model: 'random_walk', mape: 0.15, coverage_90: 0.9, n: 12 },
      ],
    },
    generated_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    stale: false,
    stale_reason: null,
    disclaimer: 'Statistical projection from past prices only. Not financial advice.',
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}
