import type { BacktestRow, ForecastPoint, ForecastResponse, HistoryPoint } from './types';

/**
 * Runtime check of a forecast payload. Anything that would make the chart or
 * numbers misleading — empty series, non-positive or non-finite prices,
 * crossed quantiles, unordered dates, a forecast that doesn't start after the
 * history — is rejected rather than drawn.
 */
export class InvalidForecastError extends Error {
  constructor(public readonly reason: string) {
    super(`Invalid forecast response: ${reason}`);
    this.name = 'InvalidForecastError';
  }
}

const QUANTILE_KEYS = ['p05', 'p25', 'p50', 'p75', 'p95'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Obj = Record<string, unknown>;

function fail(reason: string): never {
  throw new InvalidForecastError(reason);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${path} is not an object`);
  return v as Obj;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`${path}.${key} is not a string`);
  return v;
}

function date(o: Obj, key: string, path: string): string {
  const v = str(o, key, path);
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) fail(`${path}.${key} is not a date`);
  return v;
}

function finite(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key} is not a finite number`);
  return v;
}

function price(o: Obj, key: string, path: string): number {
  const v = finite(o, key, path);
  if (v <= 0) fail(`${path}.${key} must be positive`);
  return v;
}

function forecastPoint(v: unknown, path: string): ForecastPoint {
  const o = obj(v, path);
  const p = { date: date(o, 'date', path) } as ForecastPoint;
  for (const k of QUANTILE_KEYS) p[k] = price(o, k, path);
  for (let i = 1; i < QUANTILE_KEYS.length; i++) {
    if (p[QUANTILE_KEYS[i]] < p[QUANTILE_KEYS[i - 1]]) fail(`${path} quantiles are not ordered`);
  }
  return p;
}

function series<T extends { date: string }>(
  v: unknown,
  path: string,
  item: (x: unknown, p: string) => T,
): T[] {
  if (!Array.isArray(v) || v.length === 0) fail(`${path} is empty`);
  const out = v.map((x, i) => item(x, `${path}[${i}]`));
  for (let i = 1; i < out.length; i++) {
    if (out[i].date <= out[i - 1].date) fail(`${path} dates are not increasing`);
  }
  return out;
}

function backtest(v: unknown): ForecastResponse['backtest'] {
  if (v === null) return null;
  const o = obj(v, 'backtest');
  if (!Array.isArray(o.models)) fail('backtest.models is not an array');
  const models = o.models.map((m, i): BacktestRow => {
    const r = obj(m, `backtest.models[${i}]`);
    const path = `backtest.models[${i}]`;
    return {
      model: str(r, 'model', path),
      mape: finite(r, 'mape', path),
      coverage_90: finite(r, 'coverage_90', path),
      n: finite(r, 'n', path),
    };
  });
  return { horizon_days: finite(o, 'horizon_days', 'backtest'), models };
}

export function parseForecast(raw: unknown, expected?: { horizon: number; model: string }): ForecastResponse {
  const o = obj(raw, 'response');
  const history = series<HistoryPoint>(o.history, 'history', (x, p) => {
    const h = obj(x, p);
    return { date: date(h, 'date', p), close: price(h, 'close', p) };
  });
  const forecast = series(o.forecast, 'forecast', forecastPoint);
  const horizon = finite(o, 'horizon_days', 'response');
  const model = str(o, 'model', 'response');

  if (forecast.length !== horizon) fail(`forecast has ${forecast.length} days, expected ${horizon}`);
  if (forecast[0].date <= history[history.length - 1].date) fail('forecast does not start after history');
  if (expected && (expected.horizon !== horizon || expected.model !== model)) {
    fail(`got ${model}/${horizon}d, requested ${expected.model}/${expected.horizon}d`);
  }

  const summaryObj = obj(o.summary, 'summary');
  const summary = {
    ...forecastPoint(summaryObj, 'summary'),
    median_change_pct: finite(summaryObj, 'median_change_pct', 'summary'),
  };
  if (typeof o.stale !== 'boolean') fail('response.stale is not a boolean');
  if (o.stale_reason !== null && typeof o.stale_reason !== 'string') fail('response.stale_reason is invalid');

  return {
    asset: str(o, 'asset', 'response'),
    currency: str(o, 'currency', 'response'),
    model: model as ForecastResponse['model'],
    horizon_days: horizon,
    data_as_of: date(o, 'data_as_of', 'response'),
    last_close: price(o, 'last_close', 'response'),
    history,
    forecast,
    summary,
    backtest: backtest(o.backtest),
    generated_at: str(o, 'generated_at', 'response'),
    fetched_at: str(o, 'fetched_at', 'response'),
    stale: o.stale,
    stale_reason: o.stale_reason,
    disclaimer: str(o, 'disclaimer', 'response'),
  };
}
