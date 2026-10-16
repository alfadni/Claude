import { err, ok, type Result } from '../shared/result';
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  fromParts,
  parts,
  weekday,
  type LocalDate,
  type Weekday,
} from '../time/local-date';

/**
 * Recurrence rules: an RFC 5545-syntax subset with month-end clamping
 * (ADR-013). Pure calendar maths on LocalDate; no instants, so DST can never
 * shift an occurrence.
 */
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurrencePattern = Readonly<{
  frequency: Frequency;
  /** Every N periods, 1–99. */
  interval: number;
  /** Weekly only: the weekdays to repeat on (0 = Sunday). Empty = start's weekday. */
  byWeekday?: readonly Weekday[];
  /** Monthly only: 1–31 (clamped to the month's last day) or -1 = last day. */
  byMonthDay?: number | null;
}>;

export type RecurrenceSchedule = Readonly<{
  pattern: RecurrencePattern;
  startsOn: LocalDate;
  /** Inclusive. */
  endsOn?: LocalDate | null;
  maxOccurrences?: number | null;
}>;

export type RecurrenceError =
  | 'rrule_invalid'
  | 'interval_invalid'
  | 'weekday_invalid'
  | 'month_day_invalid'
  | 'end_before_start'
  | 'count_invalid';

export const MAX_INTERVAL = 99;
export const MAX_OCCURRENCES = 9999;

const FREQ_NAMES: Record<Frequency, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export function validatePattern(p: RecurrencePattern): RecurrenceError[] {
  const errors: RecurrenceError[] = [];
  if (!Number.isInteger(p.interval) || p.interval < 1 || p.interval > MAX_INTERVAL) {
    errors.push('interval_invalid');
  }
  const days = p.byWeekday ?? [];
  if (
    (days.length > 0 && p.frequency !== 'weekly') ||
    days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    new Set(days).size !== days.length
  ) {
    errors.push('weekday_invalid');
  }
  const md = p.byMonthDay;
  if (md !== undefined && md !== null) {
    if (
      p.frequency !== 'monthly' ||
      !Number.isInteger(md) ||
      !(md === -1 || (md >= 1 && md <= 31))
    ) {
      errors.push('month_day_invalid');
    }
  }
  return errors;
}

export function validateSchedule(s: RecurrenceSchedule): RecurrenceError[] {
  const errors = validatePattern(s.pattern);
  if (s.endsOn && s.endsOn < s.startsOn) errors.push('end_before_start');
  const max = s.maxOccurrences;
  if (max !== undefined && max !== null) {
    if (!Number.isInteger(max) || max < 1 || max > MAX_OCCURRENCES) errors.push('count_invalid');
  }
  return errors;
}

/** Serialise to the stored RRULE string (start/end/count live in columns). */
export function formatRRule(p: RecurrencePattern): string {
  const out = [`FREQ=${FREQ_NAMES[p.frequency]}`, `INTERVAL=${p.interval}`];
  const days = [...(p.byWeekday ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length > 0) out.push(`BYDAY=${days.map((d) => DAY_CODES[d]).join(',')}`);
  if (p.byMonthDay !== undefined && p.byMonthDay !== null) out.push(`BYMONTHDAY=${p.byMonthDay}`);
  return out.join(';');
}

/** Strict parser: anything outside the supported subset is rejected. */
export function parseRRule(value: string): Result<RecurrencePattern, RecurrenceError> {
  const fields = new Map<string, string>();
  for (const part of value.trim().split(';')) {
    const m = /^([A-Z]+)=([A-Z0-9,-]+)$/.exec(part);
    if (!m || fields.has(m[1] as string)) return err('rrule_invalid');
    fields.set(m[1] as string, m[2] as string);
  }
  const allowed = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY']);
  if ([...fields.keys()].some((k) => !allowed.has(k))) return err('rrule_invalid');

  const freqEntry = Object.entries(FREQ_NAMES).find(([, v]) => v === fields.get('FREQ'));
  if (!freqEntry) return err('rrule_invalid');
  const frequency = freqEntry[0] as Frequency;

  const intervalText = fields.get('INTERVAL') ?? '1';
  if (!/^\d{1,2}$/.test(intervalText)) return err('interval_invalid');
  const interval = Number(intervalText);

  let byWeekday: Weekday[] | undefined;
  const byDay = fields.get('BYDAY');
  if (byDay !== undefined) {
    byWeekday = [];
    for (const code of byDay.split(',')) {
      const i = DAY_CODES.indexOf(code as (typeof DAY_CODES)[number]);
      if (i < 0) return err('weekday_invalid');
      byWeekday.push(i as Weekday);
    }
  }
  let byMonthDay: number | undefined;
  const md = fields.get('BYMONTHDAY');
  if (md !== undefined) {
    if (!/^-?\d{1,2}$/.test(md)) return err('month_day_invalid');
    byMonthDay = Number(md);
  }
  const pattern: RecurrencePattern = { frequency, interval, byWeekday, byMonthDay };
  const errors = validatePattern(pattern);
  return errors.length > 0 ? err(errors[0] as RecurrenceError) : ok(pattern);
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/** Monday-based week start (WKST=MO). */
function weekStart(d: LocalDate): LocalDate {
  return addDays(d, -((weekday(d) + 6) % 7));
}

function monthIndex(d: LocalDate): number {
  const { year, month } = parts(d);
  return year * 12 + (month - 1);
}

function clampedDay(year: number, month: number, day: number): LocalDate {
  const last = daysInMonth(year, month);
  return fromParts(year, month, day === -1 ? last : Math.min(day, last));
}

/**
 * Candidate dates of period `k` (k-th interval since the anchor), ascending.
 * Each candidate is computed from the anchor, never from the previous one,
 * so month-end clamping never drifts (Jan 31 → Feb 28 → Mar 31).
 */
function periodCandidates(s: RecurrenceSchedule, k: number): LocalDate[] {
  const { pattern: p, startsOn } = s;
  const step = k * p.interval;
  switch (p.frequency) {
    case 'daily':
      return [addDays(startsOn, step)];
    case 'weekly': {
      const base = addDays(weekStart(startsOn), 7 * step);
      const days = p.byWeekday && p.byWeekday.length > 0 ? p.byWeekday : [weekday(startsOn)];
      return [...days].map((d) => addDays(base, (d + 6) % 7)).sort();
    }
    case 'monthly': {
      const start = parts(startsOn);
      const index = start.year * 12 + (start.month - 1) + step;
      const year = Math.floor(index / 12);
      return [clampedDay(year, index - year * 12 + 1, p.byMonthDay ?? start.day)];
    }
    case 'yearly': {
      const start = parts(startsOn);
      return [clampedDay(start.year + step, start.month, start.day)];
    }
  }
}

/** The period index whose candidates may include `d` (never negative). */
function periodIndexFor(s: RecurrenceSchedule, d: LocalDate): number {
  const { pattern: p, startsOn } = s;
  if (d <= s.startsOn) return 0;
  let periods: number;
  switch (p.frequency) {
    case 'daily':
      periods = diffDays(d, startsOn);
      break;
    case 'weekly':
      periods = Math.floor(diffDays(weekStart(d), weekStart(startsOn)) / 7);
      break;
    case 'monthly':
      periods = monthIndex(d) - monthIndex(startsOn);
      break;
    case 'yearly':
      periods = parts(d).year - parts(startsOn).year;
      break;
  }
  return Math.max(0, Math.floor(periods / p.interval));
}

export type Occurrence = Readonly<{ date: LocalDate }>;

/**
 * Occurrences on or after `from`, up to and including `until`, in order.
 * `alreadyGenerated` counts occurrences before `from` (for maxOccurrences).
 */
export function occurrencesBetween(
  s: RecurrenceSchedule,
  from: LocalDate,
  until: LocalDate,
  options: { alreadyGenerated?: number; limit?: number } = {},
): LocalDate[] {
  const out: LocalDate[] = [];
  const limit = options.limit ?? 1000;
  const remaining =
    s.maxOccurrences === undefined || s.maxOccurrences === null
      ? Infinity
      : s.maxOccurrences - (options.alreadyGenerated ?? 0);
  const last = s.endsOn && s.endsOn < until ? s.endsOn : until;
  const lower = from > s.startsOn ? from : s.startsOn;
  if (remaining <= 0 || last < lower) return out;

  for (let k = periodIndexFor(s, lower); ; k++) {
    const candidates = periodCandidates(s, k);
    for (const c of candidates) {
      if (c < lower) continue;
      if (c > last) return out;
      out.push(c);
      if (out.length >= remaining || out.length >= limit) return out;
    }
    // Safety: periods always advance, so this terminates once c > last.
  }
}

/** The first occurrence strictly after `d` (respecting end and count), or null. */
export function nextOccurrenceAfter(
  s: RecurrenceSchedule,
  d: LocalDate,
  alreadyGenerated: number,
): LocalDate | null {
  // Look far enough ahead for the sparsest rule (yearly x 99).
  const horizon = addMonths(d, 12 * MAX_INTERVAL + 12);
  const [first] = occurrencesBetween(s, addDays(d, 1), horizon, {
    alreadyGenerated,
    limit: 1,
  });
  return first ?? null;
}

/** First occurrence of the schedule (on or after its start), or null. */
export function firstOccurrence(s: RecurrenceSchedule): LocalDate | null {
  return nextOccurrenceAfter(s, addDays(s.startsOn, -1), 0);
}

/** Idempotency key for a generated transaction (ADR-013). */
export function recurrenceKey(ruleId: string, date: LocalDate): string {
  return `${ruleId}:${date}`;
}

/** auto_post with more than this many due at once goes to review (J5). */
export const AUTO_POST_REVIEW_THRESHOLD = 3;
