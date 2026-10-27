import {
  addDays,
  addMonths,
  calendarGrid,
  compareDates,
  contains,
  customPeriod,
  days,
  daysElapsed,
  daysInMonth,
  diffDays,
  fromParts,
  InvariantError,
  isLocalDate,
  isValidTimeZone,
  lastDay,
  lengthInDays,
  localDate,
  localDateOf,
  maxDate,
  minDate,
  monthOf,
  next,
  previous,
  shift,
  startOfDayInZone,
  weekday,
  weekOf,
  zoneOffsetMinutes,
} from '@/domain';

const d = localDate;

describe('LocalDate', () => {
  it('validates', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-00-10')).toBe(false);
    expect(isLocalDate('2026-1-1')).toBe(false);
    expect(() => localDate('nope')).toThrow(InvariantError);
  });

  it('knows month lengths and leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 13)).toBe(0);
  });

  it('does day arithmetic across month/year boundaries', () => {
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
    expect(diffDays(d('2027-01-01'), d('2026-01-01'))).toBe(365);
    expect(weekday(d('2026-10-15'))).toBe(4); // Thursday
  });

  it('clamps month arithmetic to month end (J5: rule on the 31st)', () => {
    expect(addMonths(d('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addMonths(d('2028-01-31'), 1)).toBe('2028-02-29');
    expect(addMonths(d('2026-03-31'), 1)).toBe('2026-04-30');
    expect(addMonths(d('2026-01-15'), -1)).toBe('2025-12-15');
    expect(addMonths(d('2026-01-15'), 24)).toBe('2028-01-15');
    expect(addMonths(d('2026-01-15'), -13)).toBe('2024-12-15');
  });

  it('compares', () => {
    expect(compareDates(d('2026-01-01'), d('2026-01-02'))).toBe(-1);
    expect(compareDates(d('2026-01-02'), d('2026-01-02'))).toBe(0);
    expect(compareDates(d('2026-01-03'), d('2026-01-02'))).toBe(1);
    expect(minDate(d('2026-01-01'), d('2026-01-02'))).toBe('2026-01-01');
    expect(maxDate(d('2026-01-01'), d('2026-01-02'))).toBe('2026-01-02');
    expect(fromParts(2026, 7, 4)).toBe('2026-07-04');
  });
});

describe('time zones', () => {
  // 2026-03-15T22:30:00Z
  const instant = Date.UTC(2026, 2, 15, 22, 30);

  it('shows an instant on the day it was entered, in its own zone', () => {
    expect(localDateOf(instant, 'UTC')).toBe('2026-03-15');
    expect(localDateOf(instant, 'Africa/Khartoum')).toBe('2026-03-16'); // UTC+2
    expect(localDateOf(instant, 'Asia/Dubai')).toBe('2026-03-16'); // UTC+4
    expect(localDateOf(instant, 'America/New_York')).toBe('2026-03-15');
    expect(localDateOf(instant, 'Pacific/Kiritimati')).toBe('2026-03-16'); // UTC+14
  });

  it('reports offsets', () => {
    expect(zoneOffsetMinutes(instant, 'Asia/Dubai')).toBe(240);
    expect(zoneOffsetMinutes(instant, 'Asia/Kolkata')).toBe(330);
    expect(zoneOffsetMinutes(instant, 'America/New_York')).toBe(-240); // EDT
  });

  it('validates zone names', () => {
    expect(isValidTimeZone('Africa/Khartoum')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('finds the start of a day in a zone', () => {
    expect(startOfDayInZone(d('2026-03-16'), 'Asia/Dubai')).toBe(Date.UTC(2026, 2, 15, 20, 0));
    expect(startOfDayInZone(d('2026-03-16'), 'UTC')).toBe(Date.UTC(2026, 2, 16));
  });

  it('is DST-safe: day starts across the US spring-forward', () => {
    // 2026-03-08 is the DST switch in New York (02:00 → 03:00); midnight exists.
    expect(startOfDayInZone(d('2026-03-08'), 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 5));
    expect(startOfDayInZone(d('2026-03-09'), 'America/New_York')).toBe(Date.UTC(2026, 2, 9, 4));
  });

  it('handles a zone where midnight is skipped (America/Santiago spring-forward)', () => {
    // Chile moves 00:00 → 01:00 on 2026-09-06; the day starts at 01:00 local (04:00Z).
    const start = startOfDayInZone(d('2026-09-06'), 'America/Santiago');
    expect(localDateOf(start, 'America/Santiago')).toBe('2026-09-06');
    expect(localDateOf(start - 1, 'America/Santiago')).toBe('2026-09-05');
  });

  it('handles a positive-offset zone that springs forward at midnight (Asia/Beirut)', () => {
    // Lebanon: last Sunday of March, 00:00 → 01:00 (+2 → +3). The offset at
    // naive-UTC midnight differs from the offset when the day begins.
    const day = d('2026-03-29');
    const start = startOfDayInZone(day, 'Asia/Beirut');
    expect(localDateOf(start, 'Asia/Beirut')).toBe('2026-03-29');
    expect(localDateOf(start - 1, 'Asia/Beirut')).toBe('2026-03-28');
  });
});

describe('Period', () => {
  it('builds months with half-open ends', () => {
    const feb = monthOf(d('2028-02-17'));
    expect(feb).toEqual({ kind: 'month', start: '2028-02-01', end: '2028-03-01' });
    expect(lengthInDays(feb)).toBe(29);
    expect(lastDay(feb)).toBe('2028-02-29');
    expect(contains(feb, d('2028-02-29'))).toBe(true);
    expect(contains(feb, d('2028-03-01'))).toBe(false);
    expect(contains(feb, d('2028-01-31'))).toBe(false);
  });

  it('navigates months, including from the 31st', () => {
    expect(next(monthOf(d('2026-01-31'))).start).toBe('2026-02-01');
    expect(previous(monthOf(d('2026-01-31'))).start).toBe('2025-12-01');
    expect(shift(monthOf(d('2026-01-01')), 12).start).toBe('2027-01-01');
  });

  it('builds weeks honouring the first day of week', () => {
    // 2026-10-15 is a Thursday
    expect(weekOf(d('2026-10-15'), 0)).toEqual({
      kind: 'week',
      start: '2026-10-11',
      end: '2026-10-18',
    }); // Sun
    expect(weekOf(d('2026-10-15'), 1).start).toBe('2026-10-12'); // Mon
    expect(weekOf(d('2026-10-15'), 6).start).toBe('2026-10-10'); // Sat (common in Sudan/Gulf)
    expect(weekOf(d('2026-10-10'), 6).start).toBe('2026-10-10');
    expect(next(weekOf(d('2026-10-15'), 1)).start).toBe('2026-10-19');
    expect(previous(weekOf(d('2026-10-15'), 1)).start).toBe('2026-10-05');
  });

  it('builds inclusive custom ranges', () => {
    const p = customPeriod(d('2026-01-10'), d('2026-01-12'));
    expect(days(p)).toEqual(['2026-01-10', '2026-01-11', '2026-01-12']);
    expect(next(p)).toEqual({ kind: 'custom', start: '2026-01-13', end: '2026-01-16' });
    expect(customPeriod(d('2026-01-10'), d('2026-01-10')).end).toBe('2026-01-11');
    expect(() => customPeriod(d('2026-01-12'), d('2026-01-10'))).toThrow(InvariantError);
  });

  it('counts elapsed days for "safe to spend"', () => {
    const oct = monthOf(d('2026-10-01'));
    expect(daysElapsed(oct, d('2026-09-30'))).toBe(0);
    expect(daysElapsed(oct, d('2026-10-01'))).toBe(1);
    expect(daysElapsed(oct, d('2026-10-15'))).toBe(15);
    expect(daysElapsed(oct, d('2026-11-05'))).toBe(31);
  });
});

describe('calendarGrid', () => {
  it('lays out full weeks with adjacent-month padding', () => {
    // October 2026 starts on Thursday
    const grid = calendarGrid(monthOf(d('2026-10-15')), 0);
    expect(grid).toHaveLength(5);
    expect(grid[0]?.[0]).toEqual({ date: '2026-09-27', inMonth: false });
    expect(grid[0]?.[4]).toEqual({ date: '2026-10-01', inMonth: true });
    expect(grid[4]?.[6]).toEqual({ date: '2026-10-31', inMonth: true });
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(31);
    grid.forEach((week) => expect(week).toHaveLength(7));
  });

  it('starts on Saturday when configured', () => {
    const grid = calendarGrid(monthOf(d('2026-10-15')), 6);
    expect(grid[0]?.[0]?.date).toBe('2026-09-26');
    expect(weekday(grid[0]?.[0]?.date ?? d('2026-01-01'))).toBe(6);
  });

  it('handles a 4-week February', () => {
    // Feb 2026 starts on Sunday and has 28 days
    expect(calendarGrid(monthOf(d('2026-02-01')), 0)).toHaveLength(4);
  });

  it('refuses non-month periods', () => {
    expect(() => calendarGrid(weekOf(d('2026-02-01'), 0), 0)).toThrow(InvariantError);
  });
});
