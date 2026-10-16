import {
  currentBudgetPeriod,
  evaluateBudget,
  firstOccurrence,
  formatRRule,
  goalProgress,
  inputFromTemplate,
  localDate,
  monthOf,
  newlyReached,
  nextOccurrenceAfter,
  normalizeThresholds,
  occurrencesBetween,
  parseRRule,
  parseTemplate,
  parseThresholds,
  previousBudgetPeriod,
  recurrenceKey,
  replaceCategory,
  templateFromInput,
  validateGoal,
  validateSchedule,
  weekOf,
  type LocalDate,
  type RecurrenceSchedule,
  type TransactionInput,
} from '@/domain';

const d = (s: string) => localDate(s);
const monthly = (
  startsOn: string,
  extra: Partial<RecurrenceSchedule> = {},
): RecurrenceSchedule => ({
  pattern: { frequency: 'monthly', interval: 1 },
  startsOn: d(startsOn),
  ...extra,
});

describe('RRULE subset', () => {
  it('round-trips every supported field', () => {
    for (const p of [
      { frequency: 'daily', interval: 3 },
      { frequency: 'weekly', interval: 2, byWeekday: [5, 1, 0] },
      { frequency: 'monthly', interval: 1, byMonthDay: 31 },
      { frequency: 'monthly', interval: 6, byMonthDay: -1 },
      { frequency: 'yearly', interval: 1 },
    ] as const) {
      const s = formatRRule(p);
      const back = parseRRule(s);
      expect(back.ok).toBe(true);
      if (back.ok) expect(formatRRule(back.value)).toBe(s);
    }
    expect(formatRRule({ frequency: 'weekly', interval: 2, byWeekday: [5, 1, 0] })).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR,SU',
    );
  });

  it.each([
    '',
    'FREQ=HOURLY',
    'FREQ=MONTHLY;COUNT=3',
    'FREQ=MONTHLY;UNTIL=20270101',
    'FREQ=MONTHLY;FREQ=DAILY',
    'FREQ=MONTHLY;INTERVAL=0',
    'FREQ=MONTHLY;INTERVAL=100',
    'FREQ=MONTHLY;BYMONTHDAY=32',
    'FREQ=MONTHLY;BYMONTHDAY=0',
    'FREQ=DAILY;BYMONTHDAY=3',
    'FREQ=MONTHLY;BYDAY=MO',
    'FREQ=WEEKLY;BYDAY=XX',
    'FREQ=WEEKLY;BYDAY=MO,MO',
    'freq=monthly',
  ])('rejects %p', (s) => {
    expect(parseRRule(s).ok).toBe(false);
  });

  it('validates schedule bounds', () => {
    expect(validateSchedule(monthly('2026-05-01', { endsOn: d('2026-04-30') }))).toContain(
      'end_before_start',
    );
    expect(validateSchedule(monthly('2026-05-01', { maxOccurrences: 0 }))).toContain(
      'count_invalid',
    );
    expect(validateSchedule(monthly('2026-05-01', { maxOccurrences: 12 }))).toEqual([]);
  });
});

describe('occurrence expansion', () => {
  it('J5 rent on the 1st: one per month', () => {
    expect(occurrencesBetween(monthly('2026-01-01'), d('2026-01-01'), d('2026-04-15'))).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ]);
  });

  it('J5 rule on the 31st clamps to the last day and never drifts', () => {
    const s = monthly('2026-01-31');
    expect(occurrencesBetween(s, d('2026-01-01'), d('2026-07-31'))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
    ]);
    // Leap year February.
    expect(occurrencesBetween(s, d('2028-02-01'), d('2028-02-29'))).toEqual(['2028-02-29']);
  });

  it('BYMONTHDAY=-1 is always the last day; BYMONTHDAY before the start skips to next month', () => {
    const last = {
      ...monthly('2026-01-10'),
      pattern: { frequency: 'monthly', interval: 1, byMonthDay: -1 },
    } as const;
    expect(occurrencesBetween(last, d('2026-01-01'), d('2026-03-31'))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    const tenth = {
      ...monthly('2026-01-15'),
      pattern: { frequency: 'monthly', interval: 1, byMonthDay: 10 },
    } as const;
    expect(firstOccurrence(tenth)).toBe('2026-02-10');
  });

  it('yearly on Feb 29 posts Feb 28 in common years', () => {
    const s: RecurrenceSchedule = {
      pattern: { frequency: 'yearly', interval: 1 },
      startsOn: d('2028-02-29'),
    };
    expect(occurrencesBetween(s, d('2028-01-01'), d('2033-01-01'))).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('weekly with interval and several weekdays (Monday week start)', () => {
    // 2026-10-14 is a Wednesday.
    const s: RecurrenceSchedule = {
      pattern: { frequency: 'weekly', interval: 2, byWeekday: [1, 3, 5] },
      startsOn: d('2026-10-14'),
    };
    expect(occurrencesBetween(s, d('2026-10-01'), d('2026-11-01'))).toEqual([
      '2026-10-14',
      '2026-10-16',
      '2026-10-26',
      '2026-10-28',
      '2026-10-30',
    ]);
    // Sunday belongs to the end of the Monday-based week.
    const sun: RecurrenceSchedule = {
      pattern: { frequency: 'weekly', interval: 2, byWeekday: [0] },
      startsOn: d('2026-10-14'),
    };
    expect(occurrencesBetween(sun, d('2026-10-01'), d('2026-11-08'))).toEqual([
      '2026-10-18',
      '2026-11-01',
    ]);
  });

  it('daily every 3 days; weekly default weekday is the start day', () => {
    const s: RecurrenceSchedule = {
      pattern: { frequency: 'daily', interval: 3 },
      startsOn: d('2026-12-30'),
    };
    expect(occurrencesBetween(s, d('2027-01-01'), d('2027-01-10'))).toEqual([
      '2027-01-02',
      '2027-01-05',
      '2027-01-08',
    ]);
    const w: RecurrenceSchedule = {
      pattern: { frequency: 'weekly', interval: 1 },
      startsOn: d('2026-10-14'),
    };
    expect(occurrencesBetween(w, d('2026-10-14'), d('2026-10-28'))).toEqual([
      '2026-10-14',
      '2026-10-21',
      '2026-10-28',
    ]);
  });

  it('respects the end date (inclusive) and max occurrences', () => {
    expect(
      occurrencesBetween(
        monthly('2026-01-01', { endsOn: d('2026-03-01') }),
        d('2026-01-01'),
        d('2027-01-01'),
      ),
    ).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    const counted = monthly('2026-01-01', { maxOccurrences: 3 });
    expect(occurrencesBetween(counted, d('2026-01-01'), d('2027-01-01'))).toHaveLength(3);
    expect(
      occurrencesBetween(counted, d('2026-03-01'), d('2027-01-01'), { alreadyGenerated: 2 }),
    ).toEqual(['2026-03-01']);
    expect(nextOccurrenceAfter(counted, d('2026-03-01'), 3)).toBeNull();
  });

  it('applies the per-run limit', () => {
    const s: RecurrenceSchedule = {
      pattern: { frequency: 'daily', interval: 1 },
      startsOn: d('2020-01-01'),
    };
    expect(occurrencesBetween(s, d('2020-01-01'), d('2026-01-01'), { limit: 1000 })).toHaveLength(
      1000,
    );
  });

  it('starts mid-schedule from a cursor without scanning from the anchor', () => {
    const s = monthly('2000-01-31');
    expect(nextOccurrenceAfter(s, d('2026-02-01'), 0)).toBe('2026-02-28');
    expect(nextOccurrenceAfter(s, d('2026-02-28'), 0)).toBe('2026-03-31');
    const sparse: RecurrenceSchedule = {
      pattern: { frequency: 'yearly', interval: 99 },
      startsOn: d('2026-01-01'),
    };
    expect(nextOccurrenceAfter(sparse, d('2026-01-01'), 1)).toBe('2125-01-01');
  });

  it('idempotency key is rule id + occurrence date', () => {
    expect(recurrenceKey('r1', d('2026-02-28'))).toBe('r1:2026-02-28');
  });
});

describe('recurring template', () => {
  const input: TransactionInput = {
    type: 'expense',
    accountId: 'acc',
    amountMinor: 50000,
    occurredAt: 1,
    occurredTz: 'Africa/Khartoum',
    occurredOn: d('2026-10-01'),
    note: 'Rent',
    payeeName: 'Landlord',
    tagNames: ['home'],
    splits: [{ categoryId: 'home', amountMinor: 50000 }],
  };

  it('round-trips through JSON and fills the date', () => {
    const t = templateFromInput(input);
    const parsed = parseTemplate(JSON.stringify(t));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = inputFromTemplate(
      parsed.value,
      { occurredOn: d('2026-11-01'), occurredAt: 2, occurredTz: 'Africa/Khartoum' },
      null,
    );
    expect(out).toMatchObject({
      ...input,
      occurredOn: '2026-11-01',
      occurredAt: 2,
      fxRateToBase: null,
    });
  });

  it.each([
    'not json',
    '[]',
    '{"type":"gift"}',
    '{"type":"expense","accountId":"a","amountMinor":"10"}',
    '{"type":"expense","accountId":"a","amountMinor":10,"splits":[{"categoryId":"c"}]}',
    '{"type":"expense","accountId":"a","amountMinor":10,"fxRateToBase":"-1"}',
    '{"type":"expense","accountId":"a","amountMinor":10.5}',
  ])('rejects malformed template %p', (json) => {
    expect(parseTemplate(json).ok).toBe(false);
  });

  it('replaces a merged category', () => {
    const t = replaceCategory(templateFromInput(input), 'home', 'bills');
    expect(t.splits[0]?.categoryId).toBe('bills');
  });
});

describe('budget evaluation', () => {
  const oct = monthOf(d('2026-10-01'));
  const base = {
    amountMinor: 40000,
    carryMinor: 0,
    spentMinor: 0,
    scheduledMinor: 0,
    thresholds: [50, 80, 100],
    period: oct,
    today: d('2026-10-16'),
  };

  it('J6 food 400/month: amber at 80%', () => {
    const e = evaluateBudget({ ...base, spentMinor: 32000 });
    expect(e).toMatchObject({
      percent: 80,
      reached: [50, 80],
      tone: 'warning',
      remainingMinor: 8000,
    });
    expect(evaluateBudget({ ...base, spentMinor: 31999 }).tone).toBe('ok');
    expect(evaluateBudget({ ...base, spentMinor: 40000 })).toMatchObject({
      tone: 'over',
      reached: [50, 80, 100],
    });
  });

  it('threshold comparison is exact for 15-digit amounts', () => {
    const big = 999_999_999_999_999;
    const e = evaluateBudget({ ...base, amountMinor: big, spentMinor: big - 1, thresholds: [100] });
    expect(e.reached).toEqual([]);
    expect(e.percent).toBe(99);
  });

  it('safe to spend today: remaining minus scheduled over days left, floored', () => {
    // Oct 16..31 = 16 days left including today.
    const e = evaluateBudget({ ...base, spentMinor: 10000, scheduledMinor: 1000 });
    expect(e.daysLeft).toBe(16);
    expect(e.safeToSpendTodayMinor).toBe(Math.floor(29000 / 16));
    expect(
      evaluateBudget({ ...base, spentMinor: 39500, scheduledMinor: 1000 }).safeToSpendTodayMinor,
    ).toBe(0);
    expect(evaluateBudget({ ...base, today: d('2026-11-01') })).toMatchObject({
      daysLeft: 0,
      safeToSpendTodayMinor: 0,
    });
    expect(evaluateBudget({ ...base, today: d('2026-09-30') }).daysLeft).toBe(31);
  });

  it('rollover carry (signed) changes the limit; an exhausted limit is over', () => {
    expect(evaluateBudget({ ...base, carryMinor: 5000, spentMinor: 36000 })).toMatchObject({
      limitMinor: 45000,
      percent: 80,
      tone: 'warning',
    });
    expect(evaluateBudget({ ...base, carryMinor: -40000 })).toMatchObject({
      limitMinor: 0,
      percent: 100,
      tone: 'over',
      reached: [50, 80, 100],
    });
  });

  it('alerts already sent this period never re-fire (J6)', () => {
    expect(newlyReached([50, 80], new Set())).toEqual({ record: [50, 80], announce: 80 });
    expect(newlyReached([50, 80], new Set([50, 80]))).toEqual({ record: [], announce: null });
    expect(newlyReached([50, 80, 100], new Set([50, 80]))).toEqual({
      record: [100],
      announce: 100,
    });
  });

  it('thresholds are validated and stored JSON is defensive', () => {
    expect(normalizeThresholds([100, 50, 80])).toEqual({ ok: true, value: [50, 80, 100] });
    for (const bad of [[], [0], [201], [50, 50], [1, 2, 3, 4, 5, 6], [12.5], ['80']]) {
      expect(normalizeThresholds(bad).ok).toBe(false);
    }
    expect(parseThresholds('[90]')).toEqual([90]);
    expect(parseThresholds('nope')).toEqual([50, 80, 100]);
    expect(parseThresholds('{"a":1}')).toEqual([50, 80, 100]);
  });

  it('periods: monthly, weekly (user first day), custom phases, rollover source', () => {
    const today = d('2026-10-16'); // Friday
    expect(currentBudgetPeriod({ period: 'monthly' }, today, 6).period).toEqual(oct);
    expect(currentBudgetPeriod({ period: 'weekly' }, today, 6).period).toEqual(weekOf(today, 6));
    const custom = {
      period: 'custom',
      customStart: '2026-10-20',
      customEnd: '2026-10-25',
    } as const;
    expect(currentBudgetPeriod(custom, today, 1).phase).toBe('upcoming');
    expect(currentBudgetPeriod(custom, d('2026-10-25'), 1).phase).toBe('active');
    expect(currentBudgetPeriod(custom, d('2026-10-26'), 1).phase).toBe('ended');
    expect(previousBudgetPeriod(oct)?.start).toBe('2026-09-01');
    expect(previousBudgetPeriod(currentBudgetPeriod(custom, today, 1).period)).toBeNull();
  });
});

describe('goals', () => {
  const today: LocalDate = d('2026-10-16');

  it('progress and monthly amount needed (rounded up)', () => {
    const g = goalProgress({
      savedMinor: 100000,
      targetMinor: 1000000,
      targetDate: d('2027-03-31'),
      today,
    });
    // Oct..Mar = 6 months; 900000 / 6 = 150000.
    expect(g).toMatchObject({
      percent: 10,
      status: 'active',
      monthsLeft: 6,
      monthlyNeededMinor: 150000,
    });
    const odd = goalProgress({
      savedMinor: 0,
      targetMinor: 100,
      targetDate: d('2026-12-01'),
      today,
    });
    expect(odd.monthlyNeededMinor).toBe(34); // 100 / 3 rounded up
    const huge = goalProgress({
      savedMinor: 0,
      targetMinor: 999_999_999_999_999,
      targetDate: d('2126-10-01'),
      today,
    });
    expect(huge.monthlyNeededMinor).toBe(Number((999_999_999_999_999n + 1200n) / 1201n));
  });

  it('reached, overdue, no date, negative balance', () => {
    expect(
      goalProgress({ savedMinor: 1200, targetMinor: 1000, targetDate: null, today }),
    ).toMatchObject({
      status: 'reached',
      percent: 100,
      remainingMinor: 0,
    });
    expect(
      goalProgress({ savedMinor: 10, targetMinor: 1000, targetDate: d('2026-10-01'), today }),
    ).toMatchObject({
      status: 'overdue',
      monthlyNeededMinor: null,
    });
    expect(
      goalProgress({ savedMinor: -500, targetMinor: 1000, targetDate: null, today }),
    ).toMatchObject({
      status: 'no_date',
      percent: 0,
      remainingMinor: 1500,
    });
  });

  it('validation', () => {
    const ok = { name: 'Car', targetMinor: 100, targetDate: null, linkedAccountId: 'a' };
    expect(validateGoal(ok, today, true)).toEqual([]);
    expect(validateGoal({ ...ok, name: '  ' }, today, true)).toEqual(['name_required']);
    expect(validateGoal({ ...ok, targetMinor: 0 }, today, true)).toEqual(['target_invalid']);
    expect(validateGoal({ ...ok, linkedAccountId: null }, today, true)).toEqual([
      'account_required',
    ]);
    expect(validateGoal({ ...ok, targetDate: d('2026-01-01') }, today, true)).toEqual([
      'date_in_past',
    ]);
    expect(validateGoal({ ...ok, targetDate: d('2026-01-01') }, today, false)).toEqual([]);
  });
});
