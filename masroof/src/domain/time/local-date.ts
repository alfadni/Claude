import { invariant } from '../shared/result';

/**
 * A calendar date with no time or zone: "2026-03-31".
 *
 * Transactions store the UTC instant plus the IANA zone they were entered in,
 * and are shown on the calendar day they were entered (spec §6), so a coffee
 * bought at 23:30 in Khartoum stays on that day after flying to Dubai.
 * All calendar maths runs on LocalDate in UTC, so DST never shifts a day.
 */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

/** 0 = Sunday … 6 = Saturday (matches Date#getUTCDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isLocalDate(value: string): value is LocalDate {
  const m = PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function localDate(value: string): LocalDate {
  invariant(isLocalDate(value), `Invalid LocalDate: ${value}`);
  return value;
}

export function fromParts(year: number, month: number, day: number): LocalDate {
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return localDate(`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`);
}

export function parts(d: LocalDate): { year: number; month: number; day: number } {
  const m = PATTERN.exec(d) as RegExpExecArray;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** month is 1–12. */
export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function toEpochDay(d: LocalDate): number {
  const { year, month, day } = parts(d);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function fromEpochDay(n: number): LocalDate {
  const dt = new Date(n * DAY_MS);
  return fromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(d: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(d) + days);
}

/**
 * Add calendar months, clamping to the last day when the target month is
 * shorter (Jan 31 + 1 month → Feb 28/29). Required by the "rule on the 31st"
 * recurring journey (J5).
 */
export function addMonths(d: LocalDate, months: number): LocalDate {
  const { year, month, day } = parts(d);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const mo = index - y * 12 + 1;
  return fromParts(y, mo, Math.min(day, daysInMonth(y, mo)));
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

export function weekday(d: LocalDate): Weekday {
  return new Date(toEpochDay(d) * DAY_MS).getUTCDay() as Weekday;
}

/** LocalDate strings sort lexicographically in calendar order. */
export function compareDates(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const minDate = (a: LocalDate, b: LocalDate): LocalDate => (a <= b ? a : b);
export const maxDate = (a: LocalDate, b: LocalDate): LocalDate => (a >= b ? a : b);

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

function wallClock(epochMs: number, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year as number,
    month: out.month as number,
    day: out.day as number,
    hour: (out.hour as number) % 24,
    minute: out.minute as number,
    second: out.second as number,
  };
}

/** The calendar date of an instant as seen in `timeZone`. */
export function localDateOf(epochMs: number, timeZone: string): LocalDate {
  const w = wallClock(epochMs, timeZone);
  return fromParts(w.year, w.month, w.day);
}

/** Offset of `timeZone` from UTC at `epochMs`, in minutes (east positive). */
export function zoneOffsetMinutes(epochMs: number, timeZone: string): number {
  const w = wallClock(epochMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000);
}

/**
 * First instant of `d` in `timeZone`. Handles zones whose midnight is skipped
 * by DST (returns the first existing instant of that day).
 */
export function startOfDayInZone(d: LocalDate, timeZone: string): number {
  const { year, month, day } = parts(d);
  const naiveUtc = Date.UTC(year, month - 1, day);
  // Fast path: the usual case where local midnight exists.
  const guess = naiveUtc - zoneOffsetMinutes(naiveUtc, timeZone) * 60_000;
  if (localDateOf(guess, timeZone) === d && localDateOf(guess - 1, timeZone) < d) return guess;

  // Slow path (midnight skipped by DST, odd historical offsets): UTC offsets
  // lie within [-12h, +14h], so the day starts inside this window. Binary
  // search for the first instant whose local date is >= d.
  let lo = naiveUtc - 15 * 3_600_000; // local date here is before d
  let hi = naiveUtc + 13 * 3_600_000; // local date here is d or later
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDateOf(mid, timeZone) < d) lo = mid;
    else hi = mid;
  }
  return hi;
}
