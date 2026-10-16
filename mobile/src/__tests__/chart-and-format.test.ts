import { backtestNotes } from '@/components/backtest-table';
import { MAX_RATIO, computeDomain, computeGeometry } from '@/lib/chart';
import { ageInDays, formatAge, formatDate, formatPct, formatUsd } from '@/lib/format';
import { makeForecast } from '@/test-utils/fixtures';

const BOX = { width: 320, height: 240, padLeft: 58, padRight: 8, padTop: 8, padBottom: 22 };

describe('chart geometry', () => {
  it('fits history and both bands inside the domain', () => {
    const f = makeForecast();
    const { domain, clipped } = computeDomain(f.history, f.forecast);
    expect(clipped).toBe(false);
    const all = [...f.history.map((h) => h.close), ...f.forecast.flatMap((p) => [p.p05, p.p95])];
    expect(domain[0]).toBeLessThan(Math.min(...all));
    expect(domain[1]).toBeGreaterThan(Math.max(...all));
  });

  it('starts the median and bands at today so they connect to history', () => {
    const f = makeForecast();
    const g = computeGeometry(f.history, f.forecast, BOX);
    const lastHistoryPoint = g.historyPath.split('L').pop();
    expect(g.medianPath.startsWith(`M${lastHistoryPoint}`)).toBe(true);
    expect(g.band90Path.startsWith(`M${lastHistoryPoint}`)).toBe(true);
    expect(g.band90Path.endsWith('Z')).toBe(true);
  });

  it('keeps every point inside the plot area', () => {
    const f = makeForecast({ horizon: 365, bandWidth: 0.08 });
    const g = computeGeometry(f.history, f.forecast, BOX);
    const nums = [g.historyPath, g.medianPath, g.band50Path, g.band90Path]
      .join('')
      .replace(/[MLZ]/g, ',')
      .split(',')
      .filter(Boolean)
      .map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(BOX.padLeft - 0.1);
      expect(nums[i]).toBeLessThanOrEqual(BOX.width - BOX.padRight + 0.1);
      expect(nums[i + 1]).toBeGreaterThanOrEqual(BOX.padTop - 0.1);
      expect(nums[i + 1]).toBeLessThanOrEqual(BOX.height - BOX.padBottom + 0.1);
    }
  });

  it('caps extreme bands but keeps history and the 50% band visible', () => {
    const f = makeForecast({ horizon: 365, bandWidth: 0.1 }); // p95/p05 ~ 10^2.5 at 1y, 50% band ~ 13x
    const { domain, clipped } = computeDomain(f.history, f.forecast);
    expect(clipped).toBe(true);
    expect(domain[1] / domain[0]).toBeLessThanOrEqual(MAX_RATIO * 1.5);
    const core = [...f.history.map((h) => h.close), ...f.forecast.flatMap((p) => [p.p25, p.p75])];
    expect(domain[0]).toBeLessThanOrEqual(Math.min(...core));
    expect(domain[1]).toBeGreaterThanOrEqual(Math.max(...core));
  });

  it('never cuts into the 50% band, even when it alone exceeds the cap', () => {
    const f = makeForecast({ horizon: 365, bandWidth: 0.25 }); // 50% band ~ 600x at 1y
    const { domain, clipped } = computeDomain(f.history, f.forecast);
    expect(clipped).toBe(true);
    const core = [...f.history.map((h) => h.close), ...f.forecast.flatMap((p) => [p.p25, p.p75])];
    expect(domain[0]).toBeLessThanOrEqual(Math.min(...core));
    expect(domain[1]).toBeGreaterThanOrEqual(Math.max(...core));
    expect(domain[0]).toBeGreaterThan(Math.min(...f.forecast.map((p) => p.p05)));
  });

  it('handles perfectly flat prices without dividing by zero', () => {
    const f = makeForecast({ bandWidth: 0 });
    f.history.forEach((h) => (h.close = 0.5));
    const g = computeGeometry(f.history, f.forecast, BOX);
    expect(g.domain[0]).toBeLessThan(0.5);
    expect(g.domain[1]).toBeGreaterThan(0.5);
    expect(g.historyPath).not.toMatch(/NaN|Infinity/);
  });

  it('produces distinct, increasing-price y ticks', () => {
    const f = makeForecast();
    const { yTicks } = computeGeometry(f.history, f.forecast, BOX);
    expect(yTicks.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < yTicks.length; i++) {
      expect(yTicks[i].value).toBeGreaterThan(yTicks[i - 1].value);
      expect(yTicks[i].y).toBeLessThan(yTicks[i - 1].y);
    }
  });
});

describe('format', () => {
  it('formats prices with precision by magnitude', () => {
    expect(formatUsd(0.51234)).toBe('$0.5123');
    expect(formatUsd(2.5)).toBe('$2.500');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });

  it('formats signed percentages', () => {
    expect(formatPct(4.26, true)).toBe('+4.3%');
    expect(formatPct(-2.2, true)).toBe('−2.2%');
    expect(formatPct(0.01, true)).toBe('0.0%');
  });

  it('formats dates without timezone drift', () => {
    expect(formatDate('2026-01-05')).toBe('5 Jan 2026');
    expect(formatDate('2026-12-31', false)).toBe('31 Dec');
  });

  it('measures data age in calendar days', () => {
    const now = new Date('2026-10-15T23:30:00Z');
    expect(ageInDays('2026-10-15', now)).toBe(0);
    expect(ageInDays('2026-10-12', now)).toBe(3);
    expect(formatAge('2026-10-15T23:00:00Z', now)).toBe('30 min ago');
    expect(formatAge('2026-10-12T23:30:00Z', now)).toBe('3 days ago');
  });
});

describe('backtestNotes', () => {
  const bt = (ens: number, rw: number, cov = 0.9) => ({
    horizon_days: 30,
    models: [
      { model: 'ensemble', mape: ens, coverage_90: cov, n: 12 },
      { model: 'random_walk', mape: rw, coverage_90: 0.9, n: 12 },
    ],
  });

  it('says nothing when the model beats the baseline and is calibrated', () => {
    expect(backtestNotes(bt(0.1, 0.15), 'ensemble')).toEqual([]);
  });

  it('warns when the model does not beat the no-change baseline', () => {
    expect(backtestNotes(bt(0.16, 0.15), 'ensemble')[0]).toMatch(/no more accurate than assuming no change/);
  });

  it('warns when 90% ranges were too narrow', () => {
    expect(backtestNotes(bt(0.1, 0.15, 0.58), 'ensemble')[0]).toMatch(/Only 58\.0%/);
  });
});
