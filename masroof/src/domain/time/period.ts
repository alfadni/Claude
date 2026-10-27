import { invariant } from '../shared/result';
import {
  addDays,
  addMonths,
  diffDays,
  fromParts,
  parts,
  weekday,
  type LocalDate,
  type Weekday,
} from './local-date';

/**
 * A half-open range of calendar days: [start, end). Half-open ranges tile
 * without gaps or overlaps, so "this month" + "next month" never double-counts
 * the boundary day.
 */
export type Period = Readonly<{
  kind: 'month' | 'week' | 'custom';
  start: LocalDate;
  end: LocalDate; // exclusive
}>;

export function monthOf(d: LocalDate): Period {
  const { year, month } = parts(d);
  const start = fromParts(year, month, 1);
  return { kind: 'month', start, end: addMonths(start, 1) };
}

export function weekOf(d: LocalDate, firstDayOfWeek: Weekday): Period {
  const offset = (weekday(d) - firstDayOfWeek + 7) % 7;
  const start = addDays(d, -offset);
  return { kind: 'week', start, end: addDays(start, 7) };
}

/** Inclusive user-facing range → half-open Period. */
export function customPeriod(firstDay: LocalDate, lastDay: LocalDate): Period {
  invariant(firstDay <= lastDay, 'custom period: first day must not be after last day');
  return { kind: 'custom', start: firstDay, end: addDays(lastDay, 1) };
}

export function contains(p: Period, d: LocalDate): boolean {
  return d >= p.start && d < p.end;
}

export function lengthInDays(p: Period): number {
  return diffDays(p.end, p.start);
}

export function lastDay(p: Period): LocalDate {
  return addDays(p.end, -1);
}

export function shift(p: Period, steps: number): Period {
  switch (p.kind) {
    case 'month':
      return monthOf(addMonths(p.start, steps));
    case 'week':
      return { kind: 'week', start: addDays(p.start, 7 * steps), end: addDays(p.end, 7 * steps) };
    case 'custom': {
      const len = lengthInDays(p) * steps;
      return { kind: 'custom', start: addDays(p.start, len), end: addDays(p.end, len) };
    }
  }
}

export const next = (p: Period): Period => shift(p, 1);
export const previous = (p: Period): Period => shift(p, -1);

export function days(p: Period): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = p.start; d < p.end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Days elapsed including `today`, clamped to the period (for "safe to spend"). */
export function daysElapsed(p: Period, today: LocalDate): number {
  if (today < p.start) return 0;
  if (today >= p.end) return lengthInDays(p);
  return diffDays(today, p.start) + 1;
}

export type CalendarCell = Readonly<{ date: LocalDate; inMonth: boolean }>;

/**
 * Month grid for the home calendar: full weeks starting on the user's first
 * day of week, with leading/trailing days from adjacent months flagged.
 */
export function calendarGrid(month: Period, firstDayOfWeek: Weekday): CalendarCell[][] {
  invariant(month.kind === 'month', 'calendarGrid needs a month period');
  const gridStart = weekOf(month.start, firstDayOfWeek).start;
  const gridEnd = weekOf(lastDay(month), firstDayOfWeek).end;
  const weeks: CalendarCell[][] = [];
  for (let d = gridStart; d < gridEnd;) {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i++, d = addDays(d, 1))
      week.push({ date: d, inMonth: contains(month, d) });
    weeks.push(week);
  }
  return weeks;
}
