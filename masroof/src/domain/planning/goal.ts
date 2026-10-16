import { MAX_INPUT_MINOR } from '../money/money';
import { parts, type LocalDate } from '../time/local-date';

/** Savings goals (ADR-014): progress comes from a linked account's balance. */
export type GoalInput = Readonly<{
  name: string;
  targetMinor: number;
  targetDate: LocalDate | null;
  linkedAccountId: string | null;
}>;

export type GoalError =
  'name_required' | 'name_too_long' | 'target_invalid' | 'account_required' | 'date_in_past';

export const MAX_GOAL_NAME = 60;

export function validateGoal(g: GoalInput, today: LocalDate, isNew: boolean): GoalError[] {
  const errors: GoalError[] = [];
  const name = g.name.trim();
  if (name.length === 0) errors.push('name_required');
  else if (name.length > MAX_GOAL_NAME) errors.push('name_too_long');
  if (
    !Number.isSafeInteger(g.targetMinor) ||
    g.targetMinor <= 0 ||
    g.targetMinor > MAX_INPUT_MINOR
  ) {
    errors.push('target_invalid');
  }
  if (!g.linkedAccountId) errors.push('account_required');
  // Existing goals may keep a date that has since passed (shown as overdue).
  if (isNew && g.targetDate && g.targetDate < today) errors.push('date_in_past');
  return errors;
}

export type GoalStatus = 'reached' | 'overdue' | 'active' | 'no_date';

export type GoalProgress = Readonly<{
  savedMinor: number;
  targetMinor: number;
  remainingMinor: number;
  /** 0–100 for display; exact amounts are shown alongside. */
  percent: number;
  status: GoalStatus;
  /** Whole months left including the current one (null without a date). */
  monthsLeft: number | null;
  /** Rounded up so following it reaches the target. Null if reached or no date. */
  monthlyNeededMinor: number | null;
}>;

/** Calendar months from today's month to the target's month, inclusive. */
export function monthsUntil(today: LocalDate, target: LocalDate): number {
  const a = parts(today);
  const b = parts(target);
  return (b.year - a.year) * 12 + (b.month - a.month) + 1;
}

/** Exact ceil(a / b) for non-negative safe integers (floats lose cents near 1e15). */
function ceilDiv(a: number, b: number): number {
  return Number((BigInt(a) + BigInt(b) - 1n) / BigInt(b));
}

export function goalProgress(input: {
  savedMinor: number;
  targetMinor: number;
  targetDate: LocalDate | null;
  today: LocalDate;
}): GoalProgress {
  const saved = input.savedMinor;
  const target = input.targetMinor;
  const remainingMinor = Math.max(0, target - saved);
  const percent =
    saved <= 0 ? 0 : saved >= target ? 100 : Number((BigInt(saved) * 100n) / BigInt(target));
  const reached = saved >= target;
  if (!input.targetDate) {
    return {
      savedMinor: saved,
      targetMinor: target,
      remainingMinor,
      percent,
      status: reached ? 'reached' : 'no_date',
      monthsLeft: null,
      monthlyNeededMinor: null,
    };
  }
  const overdue = !reached && input.targetDate < input.today;
  const monthsLeft = overdue ? 0 : Math.max(1, monthsUntil(input.today, input.targetDate));
  return {
    savedMinor: saved,
    targetMinor: target,
    remainingMinor,
    percent,
    status: reached ? 'reached' : overdue ? 'overdue' : 'active',
    monthsLeft,
    monthlyNeededMinor:
      reached || overdue ? null : ceilDiv(remainingMinor, Math.max(1, monthsLeft)),
  };
}
