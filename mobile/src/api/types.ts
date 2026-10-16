// Wire format of GET /v1/forecast (xrp_forecast/api.py). Field names are kept
// in snake_case to match the server exactly.

export const HORIZONS = [7, 30, 90, 180, 365] as const;
export type Horizon = (typeof HORIZONS)[number];

export type ModelName = 'ensemble' | 'random_walk' | 'gbm' | 'bootstrap' | 'log_trend' | 'holt_damped';

export interface Quantiles {
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface HistoryPoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface ForecastPoint extends Quantiles {
  date: string;
}

export interface BacktestRow {
  model: string;
  mape: number; // fraction, 0.15 = 15%
  coverage_90: number; // fraction of outcomes inside the p05-p95 band
  n: number;
}

export interface ForecastResponse {
  asset: string;
  currency: string;
  model: ModelName;
  horizon_days: number;
  data_as_of: string;
  last_close: number;
  history: HistoryPoint[];
  forecast: ForecastPoint[];
  summary: ForecastPoint & { median_change_pct: number };
  backtest: { horizon_days: number; models: BacktestRow[] } | null;
  generated_at: string;
  fetched_at: string;
  stale: boolean;
  stale_reason: string | null;
  disclaimer: string;
}
