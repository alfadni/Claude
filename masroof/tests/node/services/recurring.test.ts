import { localDate, monthOf, type RecurringMode } from '@/domain';
import { exportTransactionsCsv } from '@/services/csv/export';
import { runPlanningHeadless } from '@/services/planning/headless';
import { runRecurrenceEngine } from '@/services/planning/recurrence-engine';

import { createLedger, must, TZ, type Ledger } from '../../helpers/ledger';
import { fakeNotifications, planningFor, setDay, testTexts } from '../../helpers/planning';

const d = (s: string) => localDate(s);

function rentRule(
  l: Ledger,
  opts: { on?: string; mode?: RecurringMode; byMonthDay?: number; amountMinor?: number } = {},
) {
  const on = d(opts.on ?? '2026-10-01');
  const tx = must(
    l.repos.transactions.create(
      l.expense({
        occurredOn: on,
        amountMinor: opts.amountMinor ?? 50000,
        splits: [{ categoryId: l.ids.food, amountMinor: opts.amountMinor ?? 50000 }],
        payeeName: 'Landlord',
        accountId: l.ids.bank,
      }),
    ),
  );
  const rule = must(
    l.repos.recurring.createFromTransaction(tx.id, {
      pattern: {
        frequency: 'monthly',
        interval: 1,
        byMonthDay: opts.byMonthDay ?? Number(on.slice(8)),
      },
      mode: opts.mode ?? 'auto_post',
    }),
  );
  return { txId: tx.id, rule };
}

const run = (l: Ledger) => runRecurrenceEngine({ ...l, repos: l.repos }, l.repos.today());
const ruleRows = (l: Ledger, ruleId: string) =>
  l.sql.all<{
    occurred_on: string;
    status: string;
    deleted_at: number | null;
    amount_minor: number;
  }>(
    'SELECT occurred_on, status, deleted_at, amount_minor FROM transactions WHERE recurring_rule_id = ? ORDER BY occurred_on',
    [ruleId],
  );

describe('J5 recurring payment', () => {
  it('✅ rent monthly on the 1st, auto_post: posted on first open on/after the 1st', () => {
    const l = createLedger();
    const { txId, rule } = rentRule(l);
    // The transaction the rule was made from is occurrence #1 (no double rent for October).
    expect(l.repos.transactions.get(txId)).toMatchObject({
      recurringRuleId: rule.id,
      recurrenceKey: `${rule.id}:2026-10-01`,
    });
    expect(l.repos.recurring.get(rule.id)).toMatchObject({
      nextOn: '2026-11-01',
      occurrenceCount: 1,
    });

    expect(run(l)).toEqual({ posted: 0, pending: 0, reviewRuleIds: [], failedRuleIds: [] });
    setDay(l, '2026-11-03');
    const balanceBefore = l.repos.accounts.balances(l.repos.today()).get(l.ids.bank);
    expect(run(l)).toMatchObject({ posted: 1, pending: 0 });
    expect(ruleRows(l, rule.id).map((r) => [r.occurred_on, r.status])).toEqual([
      ['2026-10-01', 'posted'],
      ['2026-11-01', 'posted'],
    ]);
    expect(l.repos.accounts.balances(l.repos.today()).get(l.ids.bank)).toBe(
      (balanceBefore ?? 0) - 50000,
    );
    // Idempotent: running again creates nothing.
    expect(run(l)).toMatchObject({ posted: 0, pending: 0 });
    expect(ruleRows(l, rule.id)).toHaveLength(2);
  });

  it('✅ user notified: background run sends a notification without amounts', async () => {
    const l = createLedger();
    rentRule(l);
    setDay(l, '2026-11-01');
    const { planning, notifications } = planningFor(l);
    const out = await planning.run({ background: true });
    expect(out.posted).toBe(1);
    expect(notifications.presented.map((n) => n.title)).toEqual(['1 recorded']);
    for (const n of notifications.presented) expect(`${n.title} ${n.body}`).not.toMatch(/500/);
    // Foreground run: no notification (the app shows it in-app).
    setDay(l, '2026-12-01');
    notifications.presented.length = 0;
    expect((await planning.run({ background: false })).posted).toBe(1);
    expect(notifications.presented).toEqual([]);
  });

  it('✅ confirm_before_post: appears in Upcoming; confirm with edited amount, skip another', () => {
    const l = createLedger();
    const { rule } = rentRule(l, { mode: 'confirm_before_post' });
    setDay(l, '2026-12-02');
    expect(run(l)).toMatchObject({ posted: 0, pending: 2 });
    const pending = l.repos.transactions.listPending();
    expect(pending.map((p) => [p.occurredOn, p.mode, p.ruleId])).toEqual([
      ['2026-11-01', 'confirm_before_post', rule.id],
      ['2026-12-01', 'confirm_before_post', rule.id],
    ]);
    // Pending rows don't touch balances, reports, the list or CSV.
    const bankBefore = l.repos.accounts.balances(l.repos.today()).get(l.ids.bank);
    expect(
      l.repos.reports.periodTotals(monthOf(d('2026-11-01')), l.repos.today()).expenseMinor,
    ).toBe(0);
    expect(l.repos.transactions.list({}, null).map((x) => x.occurredOn)).toEqual(['2026-10-01']);
    expect(exportTransactionsCsv(l.sql, (c) => c.name)).not.toContain('2026-11-01');

    const [nov, dec] = pending;
    must(l.repos.transactions.confirmPending(nov?.id as string, 52500));
    expect(l.repos.transactions.skipPending(dec?.id as string)).toEqual({ ok: true, value: true });
    expect(ruleRows(l, rule.id).map((r) => [r.occurred_on, r.status, r.amount_minor])).toEqual([
      ['2026-10-01', 'posted', 50000],
      ['2026-11-01', 'posted', 52500],
      ['2026-12-01', 'void', 50000],
    ]);
    expect(l.repos.transactions.get(nov?.id as string)?.splits[0]?.amountMinor).toBe(52500);
    expect(l.repos.accounts.balances(l.repos.today()).get(l.ids.bank)).toBe(
      (bankBefore ?? 0) - 52500,
    );
    // Skipped never comes back; nothing pending remains.
    expect(run(l)).toMatchObject({ posted: 0, pending: 0 });
    expect(l.repos.transactions.listPending()).toEqual([]);
    expect(l.repos.transactions.skipPending(dec?.id as string)).toEqual({
      ok: false,
      error: 'not_pending',
    });
  });

  it('remind_only also lands in Upcoming (never posts by itself)', () => {
    const l = createLedger();
    rentRule(l, { mode: 'remind_only' });
    setDay(l, '2026-11-01');
    expect(run(l)).toMatchObject({ posted: 0, pending: 1 });
    expect(l.repos.transactions.listPending()[0]?.mode).toBe('remind_only');
  });

  it('confirm with a new amount is refused for a multi-split template', () => {
    const l = createLedger();
    const tx = must(
      l.repos.transactions.create(
        l.expense({
          occurredOn: d('2026-10-01'),
          amountMinor: 3000,
          splits: [
            { categoryId: l.ids.food, amountMinor: 2000 },
            { categoryId: l.ids.kids, amountMinor: 1000 },
          ],
        }),
      ),
    );
    must(
      l.repos.recurring.createFromTransaction(tx.id, {
        pattern: { frequency: 'monthly', interval: 1, byMonthDay: 1 },
        mode: 'confirm_before_post',
      }),
    );
    setDay(l, '2026-11-01');
    run(l);
    const [p] = l.repos.transactions.listPending();
    expect(l.repos.transactions.confirmPending(p?.id as string, 4000)).toEqual({
      ok: false,
      error: ['split_sum_mismatch'],
    });
    must(l.repos.transactions.confirmPending(p?.id as string));
    expect(l.repos.transactions.get(p?.id as string)?.status).toBe('posted');
  });

  it('❌ app not opened for 3 months: each missed occurrence exactly once, review if > 3', () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    setDay(l, '2027-02-10'); // Nov, Dec, Jan, Feb missed
    expect(run(l)).toEqual({ posted: 0, pending: 4, reviewRuleIds: [rule.id], failedRuleIds: [] });
    expect(ruleRows(l, rule.id).map((r) => [r.occurred_on, r.status])).toEqual([
      ['2026-10-01', 'posted'],
      ['2026-11-01', 'pending_recurring'],
      ['2026-12-01', 'pending_recurring'],
      ['2027-01-01', 'pending_recurring'],
      ['2027-02-01', 'pending_recurring'],
    ]);
    expect(run(l)).toMatchObject({ posted: 0, pending: 0 });

    // Exactly 3 missed: posted directly.
    const l2 = createLedger();
    rentRule(l2);
    setDay(l2, '2027-01-05');
    expect(run(l2)).toMatchObject({ posted: 3, pending: 0, reviewRuleIds: [] });
  });

  it('❌ rule on the 31st posts on the last day of shorter months', () => {
    const l = createLedger();
    const { rule } = rentRule(l, { on: '2026-08-31', byMonthDay: 31 });
    setDay(l, '2027-03-01');
    run(l);
    expect(ruleRows(l, rule.id).map((r) => r.occurred_on)).toEqual([
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
  });

  it('❌ device clock moved backwards: no duplicates, no deletion', () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    setDay(l, '2026-12-05');
    run(l);
    const before = ruleRows(l, rule.id);
    setDay(l, '2026-10-20'); // clock goes back
    expect(run(l)).toMatchObject({ posted: 0, pending: 0, failedRuleIds: [] });
    expect(ruleRows(l, rule.id)).toEqual(before);
    expect(l.repos.recurring.get(rule.id)?.nextOn).toBe('2027-01-01');
    setDay(l, '2027-01-02'); // and forward again
    run(l);
    expect(ruleRows(l, rule.id).map((r) => r.occurred_on)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
  });

  it('idempotency key holds even if the cursor was lost (racing run / crash)', () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    setDay(l, '2026-12-05');
    run(l);
    l.sql.run(
      'UPDATE recurring_rules SET next_occurrence_on = ?, occurrence_count = 1 WHERE id = ?',
      ['2026-11-01', rule.id],
    );
    run(l);
    expect(ruleRows(l, rule.id)).toHaveLength(3);
    expect(() =>
      l.sql.run(
        `INSERT INTO transactions (id, created_at, updated_at, version, type, account_id, amount_minor, currency,
           fx_rate_to_base, base_amount_minor, occurred_at, occurred_tz, occurred_on, recurring_rule_id, recurrence_key)
         VALUES ('dup', 1, 1, 1, 'expense', ?, 1, 'USD', '1', 1, 1, 'UTC', '2026-11-01', ?, ?)`,
        [l.ids.bank, rule.id, `${rule.id}:2026-11-01`],
      ),
    ).toThrow(/UNIQUE/);
  });

  it('a generated transaction the user deleted is not recreated', () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    setDay(l, '2026-11-02');
    run(l);
    const nov = l.sql.all<{ id: string }>(`SELECT id FROM transactions WHERE recurrence_key = ?`, [
      `${rule.id}:2026-11-01`,
    ])[0];
    must(l.repos.transactions.delete(nov?.id as string));
    l.sql.run('UPDATE recurring_rules SET next_occurrence_on = ? WHERE id = ?', [
      '2026-11-01',
      rule.id,
    ]);
    run(l);
    expect(ruleRows(l, rule.id).filter((r) => r.deleted_at === null)).toHaveLength(1);
  });

  it('archived category: the rule stops with an error, then back-fills once fixed', () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    l.repos.categories.setArchived(l.ids.food, true);
    setDay(l, '2026-12-02');
    expect(run(l)).toMatchObject({ posted: 0, failedRuleIds: [rule.id] });
    expect(l.repos.recurring.get(rule.id)).toMatchObject({
      lastError: 'category_archived',
      nextOn: '2026-11-01',
    });
    expect(ruleRows(l, rule.id)).toHaveLength(1); // nothing half-written
    l.repos.categories.setArchived(l.ids.food, false);
    expect(run(l)).toMatchObject({ posted: 2, failedRuleIds: [] });
    expect(l.repos.recurring.get(rule.id)?.lastError).toBeNull();
  });

  it('end date and max occurrences stop the rule', () => {
    const l = createLedger();
    const tx = must(l.repos.transactions.create(l.expense({ occurredOn: d('2026-10-01') })));
    const rule = must(
      l.repos.recurring.createFromTransaction(tx.id, {
        pattern: { frequency: 'monthly', interval: 1, byMonthDay: 1 },
        mode: 'auto_post',
        maxOccurrences: 3,
      }),
    );
    setDay(l, '2027-06-01');
    run(l);
    expect(ruleRows(l, rule.id)).toHaveLength(3);
    expect(l.repos.recurring.get(rule.id)?.nextOn).toBeNull();
  });

  it('pause skips the paused months; resume continues from today', () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    expect(l.repos.recurring.setPaused(rule.id, true)).toBe(true);
    setDay(l, '2027-01-15');
    expect(run(l)).toMatchObject({ posted: 0, pending: 0 });
    l.repos.recurring.setPaused(rule.id, false);
    expect(l.repos.recurring.get(rule.id)?.nextOn).toBe('2027-02-01');
    setDay(l, '2027-02-01');
    run(l);
    expect(ruleRows(l, rule.id).map((r) => r.occurred_on)).toEqual(['2026-10-01', '2027-02-01']);
  });

  it('deleting a rule voids pending occurrences and keeps posted ones', () => {
    const l = createLedger();
    const { rule } = rentRule(l, { mode: 'confirm_before_post' });
    setDay(l, '2026-11-02');
    run(l);
    expect(l.repos.recurring.delete(rule.id)).toBe(true);
    expect(ruleRows(l, rule.id).map((r) => r.status)).toEqual(['posted', 'void']);
    expect(l.repos.recurring.list().rules).toEqual([]);
    setDay(l, '2027-01-02');
    expect(run(l)).toMatchObject({ posted: 0, pending: 0 });
  });

  it('J7 "this and future" edit changes the next generated amount', () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    setDay(l, '2026-11-02');
    run(l);
    const nov = l.repos.transactions.list({}, null).find((x) => x.occurredOn === '2026-11-01');
    const detail = l.repos.transactions.get(nov?.id as string);
    if (!detail) throw new Error('missing');
    const input = {
      ...l.expense({ occurredOn: d('2026-11-01'), accountId: l.ids.bank, amountMinor: 55000 }),
      occurredAt: detail.occurredAt,
    };
    expect(l.repos.transactions.update(detail.id, input).ok).toBe(false); // scope required
    must(l.repos.transactions.update(detail.id, input, 'this_and_future'));
    setDay(l, '2026-12-01');
    run(l);
    expect(ruleRows(l, rule.id).map((r) => r.amount_minor)).toEqual([50000, 55000, 55000]);
  });

  it('changing the schedule never touches generated rows; cursor continues after them', () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    setDay(l, '2026-11-10');
    run(l);
    must(
      l.repos.recurring.updateSettings(rule.id, {
        pattern: { frequency: 'monthly', interval: 1, byMonthDay: 15 },
        mode: 'confirm_before_post',
      }),
    );
    expect(l.repos.recurring.get(rule.id)).toMatchObject({
      nextOn: '2026-11-15',
      mode: 'confirm_before_post',
    });
    expect(ruleRows(l, rule.id).map((r) => r.occurred_on)).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('a rule can start later than the transaction (not linked) but never earlier', () => {
    const l = createLedger();
    const tx = must(l.repos.transactions.create(l.expense({ occurredOn: d('2026-10-03') })));
    expect(
      l.repos.recurring.createFromTransaction(tx.id, {
        pattern: { frequency: 'monthly', interval: 1, byMonthDay: 1 },
        mode: 'auto_post',
        startsOn: d('2026-10-01'),
      }),
    ).toEqual({ ok: false, error: ['start_before_transaction'] });
    const rule = must(
      l.repos.recurring.createFromTransaction(tx.id, {
        pattern: { frequency: 'monthly', interval: 1, byMonthDay: 1 },
        mode: 'auto_post',
      }),
    );
    expect(rule.nextOn).toBe('2026-11-01');
    expect(l.repos.transactions.get(tx.id)?.recurringRuleId).toBeNull();
    // Already in a rule → not eligible again; nor are deleted ones.
    const linked = rentRule(l);
    expect(
      l.repos.recurring.createFromTransaction(linked.txId, {
        pattern: { frequency: 'monthly', interval: 1 },
        mode: 'auto_post',
      }),
    ).toEqual({ ok: false, error: ['transaction_not_eligible'] });
    must(l.repos.transactions.delete(tx.id));
    expect(
      l.repos.recurring.createFromTransaction(tx.id, {
        pattern: { frequency: 'monthly', interval: 1 },
        mode: 'auto_post',
      }).ok,
    ).toBe(false);
  });

  it('unreadable rule rows are reported, not guessed at', () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    l.sql.run(`UPDATE recurring_rules SET rrule = 'FREQ=HOURLY' WHERE id = ?`, [rule.id]);
    expect(l.repos.recurring.list()).toEqual({ rules: [], unreadableIds: [rule.id] });
    setDay(l, '2027-01-01');
    expect(run(l)).toMatchObject({ posted: 0, pending: 0 });
  });
});

describe('J5 notifications', () => {
  it('reminder for the next occurrence at 09:00 local; paused/deleted rules are cancelled', async () => {
    const l = createLedger();
    const { rule } = rentRule(l);
    const { planning, notifications } = planningFor(l);
    await planning.refreshReminders();
    const s = notifications.scheduled.get(`recurring:${rule.id}`);
    // 2026-11-01 09:00 in Khartoum (UTC+2) = 07:00 UTC.
    expect(s).toMatchObject({ at: Date.UTC(2026, 10, 1, 7, 0), title: 'Landlord due (auto_post)' });
    l.repos.recurring.setPaused(rule.id, true);
    await planning.refreshReminders();
    expect(notifications.scheduled.size).toBe(0);
  });

  it('❌ permission denied: in-app inbox still works, nothing scheduled or presented', async () => {
    const l = createLedger();
    rentRule(l, { mode: 'confirm_before_post' });
    const { planning, notifications } = planningFor(l, fakeNotifications('denied'));
    setDay(l, '2026-11-02');
    const out = await planning.run({ background: true });
    expect(out.pending).toBe(1);
    expect(l.repos.transactions.listPending()).toHaveLength(1);
    expect(notifications.presented).toEqual([]);
    expect(notifications.scheduled.size).toBe(0);
    expect(await planning.ensurePermission()).toBe('denied');
    expect(notifications.requests).toBe(0); // never re-prompts once denied
  });

  it('asks in context only while undetermined', async () => {
    const l = createLedger();
    const { planning, notifications } = planningFor(l, fakeNotifications('undetermined'));
    expect(await planning.ensurePermission()).toBe('granted');
    expect(await planning.ensurePermission()).toBe('granted');
    expect(notifications.requests).toBe(1);
  });
});

describe('background task (headless)', () => {
  it('does nothing without a key (fresh install or keychain locked)', async () => {
    const out = await runPlanningHeadless({
      open: {
        secrets: { get: async () => null, set: async () => undefined },
        randomBytes: (n) => new Uint8Array(n),
        openConnection: () => {
          throw new Error('must not open');
        },
        requireCipher: true,
      },
      randomBytes: (n) => new Uint8Array(n),
      notifications: fakeNotifications(),
      texts: () => testTexts,
      timeZone: () => TZ,
    });
    expect(out).toBeNull();
  });

  it('does nothing when the keychain throws (device locked)', async () => {
    const out = await runPlanningHeadless({
      open: {
        secrets: {
          get: async () => {
            throw new Error('locked');
          },
          set: async () => undefined,
        },
        randomBytes: (n) => new Uint8Array(n),
        openConnection: () => {
          throw new Error('must not open');
        },
        requireCipher: true,
      },
      randomBytes: (n) => new Uint8Array(n),
      notifications: fakeNotifications(),
      texts: () => testTexts,
      timeZone: () => TZ,
    });
    expect(out).toBeNull();
  });
});
