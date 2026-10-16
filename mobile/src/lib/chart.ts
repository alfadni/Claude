import type { ForecastPoint, HistoryPoint } from '@/api/types';

/**
 * Geometry for the forecast chart, kept free of React so it can be tested.
 *
 * Prices use a log y-axis: a +50% and a −33% move look symmetric, and XRP's
 * wide long-horizon bands stay readable next to the history. If the outer
 * (90%) band would still need more than MAX_RATIO between axis min and max,
 * the axis is capped so history and the 50% band stay legible, and `clipped`
 * is set so the UI can say the outer band runs off the chart.
 */

export const MAX_RATIO = 100;

export interface ChartBox {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface ChartGeometry {
  historyPath: string;
  medianPath: string;
  band50Path: string;
  band90Path: string;
  todayX: number;
  yTicks: { y: number; value: number }[];
  xLabels: { x: number; date: string; anchor: 'start' | 'middle' | 'end' }[];
  domain: [number, number];
  clipped: boolean;
}

export function computeDomain(
  history: HistoryPoint[],
  forecast: ForecastPoint[],
): { domain: [number, number]; clipped: boolean } {
  const core = [...history.map((h) => h.close), ...forecast.flatMap((f) => [f.p25, f.p75])];
  let lo = Math.min(...core, ...forecast.map((f) => f.p05));
  let hi = Math.max(...core, ...forecast.map((f) => f.p95));
  let clipped = false;
  if (hi / lo > MAX_RATIO) {
    clipped = true;
    const coreLo = Math.min(...core);
    const coreHi = Math.max(...core);
    // Keep the core fully visible (even if it alone exceeds MAX_RATIO), then
    // spend any remaining ratio evenly in log space on each side, without
    // going past the real extremes.
    const spare = Math.max(1, Math.sqrt(MAX_RATIO / (coreHi / coreLo)));
    lo = Math.max(lo, coreLo / spare);
    hi = Math.min(hi, coreHi * spare);
  }
  if (hi <= lo * 1.0001) {
    lo *= 0.95;
    hi *= 1.05;
  } else {
    // 4% headroom so lines don't touch the frame.
    const pad = Math.log(hi / lo) * 0.04;
    lo = Math.exp(Math.log(lo) - pad);
    hi = Math.exp(Math.log(hi) + pad);
  }
  return { domain: [lo, hi], clipped };
}

function roundSig(v: number, digits = 2): number {
  const p = 10 ** (Math.floor(Math.log10(v)) - digits + 1);
  return Math.round(v / p) * p;
}

export function computeGeometry(
  history: HistoryPoint[],
  forecast: ForecastPoint[],
  box: ChartBox,
): ChartGeometry {
  const { domain, clipped } = computeDomain(history, forecast);
  const [lo, hi] = domain;
  const innerW = box.width - box.padLeft - box.padRight;
  const innerH = box.height - box.padTop - box.padBottom;
  const total = history.length + forecast.length - 1;
  const llo = Math.log(lo);
  const lspan = Math.log(hi) - llo;

  const X = (i: number) => box.padLeft + (i / Math.max(total, 1)) * innerW;
  const Y = (v: number) => {
    const clamped = Math.min(Math.max(v, lo), hi);
    return box.padTop + (1 - (Math.log(clamped) - llo) / lspan) * innerH;
  };
  const pt = (i: number, v: number) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
  const line = (pts: string[]) => (pts.length ? `M${pts.join('L')}` : '');

  const last = history.length - 1;
  const lastClose = history[last].close;
  // Forecast paths start at today's close so they connect to the history.
  const fIdx = (j: number) => last + 1 + j;
  const band = (lower: keyof ForecastPoint, upper: keyof ForecastPoint) => {
    const up = [pt(last, lastClose), ...forecast.map((f, j) => pt(fIdx(j), f[upper] as number))];
    const down = forecast.map((f, j) => pt(fIdx(j), f[lower] as number)).reverse();
    return `${line([...up, ...down])}Z`;
  };

  const tickCount = 5;
  const yTicks = Array.from({ length: tickCount }, (_, k) => {
    const value = roundSig(Math.exp(llo + ((k + 0.5) / tickCount) * lspan));
    return { value, y: Y(value) };
  }).filter((t, k, arr) => k === 0 || t.value !== arr[k - 1].value);

  return {
    historyPath: line(history.map((h, i) => pt(i, h.close))),
    medianPath: line([pt(last, lastClose), ...forecast.map((f, j) => pt(fIdx(j), f.p50))]),
    band50Path: band('p25', 'p75'),
    band90Path: band('p05', 'p95'),
    todayX: X(last),
    yTicks,
    xLabels: [
      { x: X(0), date: history[0].date, anchor: 'start' },
      { x: X(last), date: history[last].date, anchor: 'middle' },
      { x: X(total), date: forecast[forecast.length - 1].date, anchor: 'end' },
    ],
    domain,
    clipped,
  };
}
