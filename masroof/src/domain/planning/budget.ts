import { err, ok, type Result } from '../shared/result';
import { localDate, type LocalDate, type Weekday } from '../time/local-date';
import {
  customPeriod,
  daysElapsed,
  lengthInDays,
  monthOf,
  previous,
  weekOf,
  type Period,
} from '../time/period';

/** Budgets (ADR-014). All amounts are base-currency minor units. */
export type BudgetPeriodKind = 'monthly' | 'weekly' | 'custom';

export type BudgetShape = Readonly<{
  period: BudgetPeriodKind;
  /** Custom only, inclusive. */
  customStart?: string | null;
  customEnd?: string | null;
}>;

export const DEFAULT_THRESHOLDS: readonly number[] = [50, 80, 100];
export const MAX_THRESHOLDS = 5;
export const WARNING_PERCENT = 80;

export type ThresholdError = 'thresholds_invalid';

/** 1–200, integers, unique, at most 5; returned sorted ascending. */
export function normalizeThresholds(values: readonly unknown[]): Result<number[], ThresholdError> {
  if (values.length === 0 || values.length > MAX_THRESHOLDS) return err('thresholds_invalid');
  const out: number[] = [];
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 200) {
      return err('thresholds_invalid');
    }
    out.push(v);
  }
  if (new Set(out).size !== out.length) return err('thresholds_invalid');
  return ok(out.sort((a, b) => a - b));
}

/** Stored JSON → thresholds; anything malformed falls back to the default. */
export function parseThresholds(json: string): number[] {
  try {
    const v: unknown = JSON.parse(json);
    if (Array.isArray(v)) {
      const r = normalizeThresholds(v);
      if (r.ok) return r.value;
    }
  } catch {
    // fall through
  }
  return [...DEFAULT_THRESHOLDS];
}

export type PeriodPhase = 'upcoming' | 'active' | 'ended';

/** The period that applies today, and whether a custom one has started/ended. */
export function currentBudgetPeriod(
  b: BudgetShape,
  today: LocalDate,
  firstDayOfWeek: Weekday,
): { period: Period; phase: PeriodPhase } {
  switch (b.period) {
    case 'monthly':
      return { period: monthOf(today), phase: 'active' };
    case 'weekly':
      return { period: weekOf(today, firstDayOfWeek), phase: 'active' };
    case 'custom': {
      const period = customPeriod(
        localDate(b.customStart as string),
        localDate(b.customEnd as string),
      );
      const phase = today < period.start ? 'upcoming' : today >= period.end ? 'ended' : 'active';
      return { period, phase };
    }
  }
}

/** Rollover source: the period just before `p` (custom budgets don't repeat). */
export function previousBudgetPeriod(p: Period): Period | null {
  return p.kind === 'custom' ? null : previous(p);
}

export type BudgetTone = 'ok' | 'warning' | 'over';

export type BudgetEvaluation = Readonly<{
  /** amount + carry. May be <= 0 after an overspent rolled-over period. */
  limitMinor: number;
  spentMinor: number;
  /** Future-dated expenses inside the period (reserved, not spent). */
  scheduledMinor: number;
  remainingMinor: number;
  /** floor(spent / limit * 100); 100 when the limit is <= 0. */
  percent: number;
  reached: number[];
  tone: BudgetTone;
  daysLeft: number;
  safeToSpendTodayMinor: number;
}>;

/** spent*100 >= threshold*limit, exactly (BigInt: 15-digit amounts x 200). */
function reachedThreshold(spent: number, limit: number, threshold: number): boolean {
  if (limit <= 0) return true;
  return BigInt(spent) * 100n >= BigInt(threshold) * BigInt(limit);
}

export function evaluateBudget(input: {
  amountMinor: number;
  carryMinor: number;
  spentMinor: number;
  scheduledMinor: number;
  thresholds: readonly number[];
  period: Period;
  today: LocalDate;
}): BudgetEvaluation {
  const limitMinor = input.amountMinor + input.carryMinor;
  const spent = input.spentMinor;
  const remainingMinor = limitMinor - spent;
  // A limit of zero or less (overspend rolled over) means nothing is left.
  const exhausted = limitMinor <= 0;
  const percent = exhausted ? 100 : Number((BigInt(spent) * 100n) / BigInt(limitMinor));
  const reached = input.thresholds.filter((t) => reachedThreshold(spent, limitMinor, t));
  const tone: BudgetTone =
    exhausted || spent >= limitMinor
      ? 'over'
      : reachedThreshold(spent, limitMinor, WARNING_PERCENT)
        ? 'warning'
        : 'ok';

  const total = lengthInDays(input.period);
  const elapsedBeforeToday = Math.max(0, daysElapsed(input.period, input.today) - 1);
  const daysLeft = input.today >= input.period.end ? 0 : total - elapsedBeforeToday;
  const available = remainingMinor - input.scheduledMinor;
  // Floor keeps the figure conservative; never suggest spending a negative amount.
  const safeToSpendTodayMinor =
    daysLeft <= 0 || available <= 0 ? 0 : Number(BigInt(available) / BigInt(daysLeft));

  return {
    limitMinor,
    spentMinor: spent,
    scheduledMinor: input.scheduledMinor,
    remainingMinor,
    percent,
    reached,
    tone,
    daysLeft,
    safeToSpendTodayMinor,
  };
}

/**
 * Thresholds to notify now: reached minus already sent this period. Only the
 * highest is announced; all are recorded so none re-fires (J6).
 */
export function newlyReached(
  reached: readonly number[],
  alreadySent: ReadonlySet<number>,
): { record: number[]; announce: number | null } {
  const record = reached.filter((t) => !alreadySent.has(t));
  return { record, announce: record.length > 0 ? Math.max(...record) : null };
}
