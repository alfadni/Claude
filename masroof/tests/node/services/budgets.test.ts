import { localDate } from '@/domain';

import { createLedger, must, type Ledger } from '../../helpers/ledger';
import { fakeNotifications, planningFor, setDay } from '../../helpers/planning';

const d = (s: string) => localDate(s);

function foodBudget(
  l: Ledger,
  over: Partial<Parameters<Ledger['repos']['budgets']['create']>[0]> = {},
) {
  return must(
    l.repos.budgets.create({
      categoryId: l.ids.food,
      period: 'monthly',
      amountMinor: 40000,
      rollover: false,
      thresholds: [50, 80, 100],
      ...over,
    }),
  );
}

const spend = (l: Ledger, amountMinor: number, on = '2026-10-15', categoryId = l.ids.food) =>
  must(
    l.repos.transactions.create(
      l.expense({
        amountMinor,
        occurredOn: d(on),
        accountId: l.ids.bank,
        splits: [{ categoryId, amountMinor }],
      }),
    ),
  ).id;

describe('J6 budgets', () => {
  it('✅ food 400/month: at 80% a local notification fires and the strip turns amber', async () => {
    const l = createLedger();
    const b = foodBudget(l);
    const { planning, notifications } = planningFor(l);
    spend(l, 10000);
    expect(await planning.afterWrite()).toEqual([]);
    spend(l, 12000); // 220 / 400 = 55%
    expect(await planning.afterWrite()).toEqual([
      { budgetId: b.id, categoryId: l.ids.food, threshold: 50 },
    ]);
    spend(l, 10000); // 320 / 400 = 80%
    expect((await planning.afterWrite()).map((a) => a.threshold)).toEqual([80]);
    expect(notifications.presented.map((n) => n.title)).toEqual([
      `${l.ids.food} 50%`,
      `${l.ids.food} 80%`,
    ]);
    for (const n of notifications.presented) expect(n.body).not.toMatch(/320|400/);
    const [s] = l.repos.budgets.statuses();
    expect(s?.evaluation).toMatchObject({ percent: 80, tone: 'warning', spentMinor: 32000 });
  });

  it('a single save crossing several thresholds announces only the highest', async () => {
    const l = createLedger();
    foodBudget(l);
    const { planning, notifications } = planningFor(l);
    spend(l, 41000);
    expect((await planning.afterWrite()).map((a) => a.threshold)).toEqual([100]);
    expect(notifications.presented).toHaveLength(1);
    expect(l.repos.budgets.statuses()[0]?.evaluation?.tone).toBe('over');
  });

  it('❌ expense edited/deleted: recalculated, and alerts never re-fire in the same period', async () => {
    const l = createLedger();
    foodBudget(l);
    const { planning } = planningFor(l);
    const id = spend(l, 33000);
    expect((await planning.afterWrite()).map((a) => a.threshold)).toEqual([80]);
    must(l.repos.transactions.delete(id));
    expect(l.repos.budgets.statuses()[0]?.evaluation).toMatchObject({ spentMinor: 0, tone: 'ok' });
    expect(await planning.afterWrite()).toEqual([]);
    must(l.repos.transactions.restore(id));
    expect(await planning.afterWrite()).toEqual([]); // 50 and 80 already sent this period
    expect(l.repos.budgets.statuses()[0]?.evaluation?.spentMinor).toBe(33000);
    // A new month starts clean.
    setDay(l, '2026-11-05');
    spend(l, 33000, '2026-11-05');
    expect((await planning.afterWrite()).map((a) => a.threshold)).toEqual([80]);
  });

  it('❌ budget currency ≠ transaction currency: stored base amounts are used', () => {
    const l = createLedger();
    foodBudget(l);
    const eur = must(
      l.repos.accounts.create({
        name: 'Euro',
        type: 'bank',
        currency: 'EUR',
        openingBalanceMinor: 0,
        openedOn: null,
        includeInTotals: true,
      }),
    );
    must(
      l.repos.transactions.create(
        l.expense({
          accountId: eur.id,
          amountMinor: 10000,
          fxRateToBase: '1.1' as never,
          splits: [{ categoryId: l.ids.food, amountMinor: 10000 }],
        }),
      ),
    );
    // Later rates don't matter: the frozen base amount (110.00 USD) counts.
    l.repos.fx.record('EUR', 'USD', '2' as never, d('2026-10-15'));
    expect(l.repos.budgets.statuses()[0]?.evaluation?.spentMinor).toBe(11000);
  });

  it('a budget in another currency converts its limit; with no rate, no alert fires', async () => {
    const l = createLedger();
    const b = foodBudget(l);
    l.sql.run(`UPDATE budgets SET currency = 'EUR' WHERE id = ?`, [b.id]);
    spend(l, 39000);
    const { planning } = planningFor(l);
    expect(l.repos.budgets.statuses()[0]).toMatchObject({ missingRate: true, evaluation: null });
    expect(await planning.afterWrite()).toEqual([]);
    l.repos.fx.record('EUR', 'USD', '1.25' as never, d('2026-10-01'));
    // 400 EUR = 500 USD; 390 / 500 = 78%.
    expect(l.repos.budgets.statuses()[0]?.evaluation).toMatchObject({
      limitMinor: 50000,
      percent: 78,
    });
  });

  it('scheduled (future-dated) expenses are reserved, not spent', () => {
    const l = createLedger();
    foodBudget(l);
    spend(l, 10000);
    spend(l, 5000, '2026-10-28');
    expect(l.repos.budgets.statuses()[0]?.evaluation).toMatchObject({
      spentMinor: 10000,
      scheduledMinor: 5000,
      // (400 - 100 - 50) / 17 days left (Oct 15..31), floored
      safeToSpendTodayMinor: Math.floor(25000 / 17),
    });
  });

  it('transfers, income and other categories never count; sub-categories do', () => {
    const l = createLedger();
    foodBudget(l);
    must(l.repos.transactions.create(l.transfer()));
    must(l.repos.transactions.create(l.income({ amountMinor: 90000 })));
    spend(l, 7000, '2026-10-15', l.ids.kids);
    const child = must(l.repos.categories.create({ name: 'Groceries', kind: 'expense' }));
    l.sql.run('UPDATE categories SET parent_id = ? WHERE id = ?', [l.ids.food, child.id]);
    spend(l, 2500, '2026-10-15', child.id);
    expect(l.repos.budgets.statuses()[0]?.evaluation?.spentMinor).toBe(2500);
  });

  it('overall budget covers every expense category', () => {
    const l = createLedger();
    must(
      l.repos.budgets.create({
        categoryId: null,
        period: 'monthly',
        amountMinor: 100000,
        rollover: false,
        thresholds: [80],
      }),
    );
    spend(l, 7000, '2026-10-15', l.ids.kids);
    spend(l, 3000);
    expect(l.repos.budgets.statuses()[0]?.evaluation?.spentMinor).toBe(10000);
  });

  it('rollover carries the previous period leftover (signed)', () => {
    const l = createLedger();
    l.clock.now = Date.UTC(2026, 8, 1, 8); // created in September
    const b = foodBudget(l, { rollover: true });
    spend(l, 30000, '2026-09-10');
    setDay(l, '2026-10-15');
    expect(l.repos.budgets.status(b)).toMatchObject({ evaluation: { limitMinor: 50000 } });
    spend(l, 20000, '2026-09-20'); // September now overspent by 100
    expect(l.repos.budgets.status(b).evaluation?.limitMinor).toBe(30000);
    // No carry into the first period of a brand-new budget.
    const fresh = must(
      l.repos.budgets.create({
        categoryId: l.ids.kids,
        period: 'monthly',
        amountMinor: 1000,
        rollover: true,
        thresholds: [80],
      }),
    );
    expect(l.repos.budgets.status(fresh).evaluation?.limitMinor).toBe(1000);
  });

  it('weekly and custom periods', () => {
    const l = createLedger();
    l.repos.settings.set('firstDayOfWeek', 6); // Saturday
    const w = must(
      l.repos.budgets.create({
        categoryId: l.ids.food,
        period: 'weekly',
        amountMinor: 10000,
        rollover: false,
        thresholds: [100],
      }),
    );
    spend(l, 1000, '2026-10-10'); // Saturday, this week
    spend(l, 1000, '2026-10-09'); // Friday, last week
    expect(l.repos.budgets.status(w)).toMatchObject({
      period: { start: '2026-10-10', end: '2026-10-17' },
      evaluation: { spentMinor: 1000 },
    });
    const c = must(
      l.repos.budgets.create({
        categoryId: l.ids.food,
        period: 'custom',
        customStart: d('2026-10-20'),
        customEnd: d('2026-10-25'),
        amountMinor: 10000,
        rollover: true,
        thresholds: [100],
      }),
    );
    expect(c.rollover).toBe(false); // custom budgets don't roll over
    expect(l.repos.budgets.status(c).phase).toBe('upcoming');
  });

  it('validation: duplicates, income categories, bad dates and thresholds', () => {
    const l = createLedger();
    foodBudget(l);
    const create = (over: object) =>
      l.repos.budgets.create({
        categoryId: l.ids.kids,
        period: 'monthly',
        amountMinor: 1000,
        rollover: false,
        thresholds: [80],
        ...over,
      });
    expect(create({ categoryId: l.ids.food })).toEqual({ ok: false, error: ['budget_exists'] });
    expect(create({ categoryId: l.ids.salary })).toEqual({
      ok: false,
      error: ['category_not_expense'],
    });
    expect(create({ categoryId: 'nope' })).toEqual({ ok: false, error: ['category_missing'] });
    expect(create({ amountMinor: 0 })).toEqual({ ok: false, error: ['amount_invalid'] });
    expect(create({ thresholds: [] })).toEqual({ ok: false, error: ['thresholds_invalid'] });
    expect(
      create({ period: 'custom', customStart: d('2026-10-05'), customEnd: d('2026-10-01') }),
    ).toEqual({
      ok: false,
      error: ['custom_dates_invalid'],
    });
    l.repos.categories.setArchived(l.ids.kids, true);
    expect(create({})).toEqual({ ok: false, error: ['category_archived'] });
    // A deleted budget frees its slot.
    const food = l.repos.budgets.list()[0];
    expect(l.repos.budgets.delete(food?.id as string)).toBe(true);
    expect(create({ categoryId: l.ids.food }).ok).toBe(true);
  });

  it('❌ category archived: the budget stays and is flagged for the user', () => {
    const l = createLedger();
    const b = foodBudget(l);
    l.repos.categories.setArchived(l.ids.food, true);
    expect(l.repos.budgets.status(b).categoryArchived).toBe(true);
    // Editing it to another category resolves the prompt.
    must(
      l.repos.budgets.update(b.id, {
        categoryId: l.ids.kids,
        period: 'monthly',
        amountMinor: 40000,
        rollover: false,
        thresholds: [80],
      }),
    );
    expect(l.repos.budgets.status(l.repos.budgets.get(b.id) as never).categoryArchived).toBe(false);
  });
});

describe('J6 category merge', () => {
  it('❌ merged: splits, budget and rule templates migrate; the source is archived', () => {
    const l = createLedger();
    const b = foodBudget(l);
    const tx = spend(l, 1500);
    const rule = must(
      l.repos.recurring.createFromTransaction(tx, {
        pattern: { frequency: 'monthly', interval: 1, byMonthDay: 15 },
        mode: 'auto_post',
      }),
    );
    expect(l.repos.categoryMerge.merge(l.ids.food, l.ids.kids)).toEqual({
      ok: true,
      value: { movedSplits: 1, movedBudgets: 1, rulesUpdated: 1 },
    });
    expect(l.repos.transactions.get(tx)?.splits[0]?.categoryId).toBe(l.ids.kids);
    expect(l.repos.budgets.get(b.id)?.categoryId).toBe(l.ids.kids);
    expect(l.repos.recurring.get(rule.id)?.template.splits[0]?.categoryId).toBe(l.ids.kids);
    expect(l.repos.categories.get(l.ids.food)?.isArchived).toBe(true);
    expect(l.repos.budgets.statuses()[0]?.evaluation?.spentMinor).toBe(1500);
  });

  it('a clashing target budget prompts: keep the target or combine', () => {
    const l = createLedger();
    const food = foodBudget(l);
    const kids = must(
      l.repos.budgets.create({
        categoryId: l.ids.kids,
        period: 'monthly',
        amountMinor: 10000,
        rollover: false,
        thresholds: [80],
      }),
    );
    expect(l.repos.categoryMerge.conflicts(l.ids.food, l.ids.kids)).toHaveLength(1);
    expect(l.repos.categoryMerge.merge(l.ids.food, l.ids.kids)).toEqual({
      ok: false,
      error: 'budget_conflict',
    });
    expect(l.repos.categories.get(l.ids.food)?.isArchived).toBe(false); // nothing changed

    must(l.repos.categoryMerge.merge(l.ids.food, l.ids.kids, 'combine'));
    expect(l.repos.budgets.get(kids.id)?.amountMinor).toBe(50000);
    expect(l.repos.budgets.get(food.id)).toBeUndefined();

    const l2 = createLedger();
    foodBudget(l2);
    const k2 = must(
      l2.repos.budgets.create({
        categoryId: l2.ids.kids,
        period: 'monthly',
        amountMinor: 10000,
        rollover: false,
        thresholds: [80],
      }),
    );
    must(l2.repos.categoryMerge.merge(l2.ids.food, l2.ids.kids, 'keep_target'));
    expect(l2.repos.budgets.list().map((b) => [b.id, b.amountMinor])).toEqual([[k2.id, 10000]]);
  });

  it('refuses unsafe merges', () => {
    const l = createLedger();
    const m = l.repos.categoryMerge;
    expect(m.merge(l.ids.food, l.ids.food)).toEqual({ ok: false, error: 'same_category' });
    expect(m.merge(l.ids.food, l.ids.salary)).toEqual({ ok: false, error: 'kind_mismatch' });
    expect(m.merge(l.ids.food, 'missing')).toEqual({ ok: false, error: 'not_found' });
    l.repos.categories.setArchived(l.ids.kids, true);
    expect(m.merge(l.ids.food, l.ids.kids)).toEqual({ ok: false, error: 'target_archived' });
    const child = must(l.repos.categories.create({ name: 'Snacks', kind: 'expense' }));
    l.sql.run('UPDATE categories SET parent_id = ? WHERE id = ?', [l.ids.food, child.id]);
    const sub = must(l.repos.categories.create({ name: 'Toys', kind: 'expense' }));
    l.sql.run('UPDATE categories SET parent_id = ? WHERE id = ?', [l.ids.clothes, sub.id]);
    expect(m.merge(l.ids.food, sub.id)).toEqual({ ok: false, error: 'source_has_children' });
    must(m.merge(l.ids.food, l.ids.clothes));
    expect(l.repos.categories.get(child.id)?.parentId).toBe(l.ids.clothes);
  });
});

describe('goals', () => {
  it('progress from the linked account balance', () => {
    const l = createLedger();
    const g = must(
      l.repos.goals.create({
        name: 'Car',
        targetMinor: 1000000,
        targetDate: d('2027-03-31'),
        linkedAccountId: l.ids.bank,
      }),
    );
    expect(g.currency).toBe('USD');
    const [s] = l.repos.goals.statuses();
    // Bank opening balance 1,000.00 of 10,000.00
    expect(s).toMatchObject({
      accountName: 'Bank',
      progress: { savedMinor: 100000, percent: 10, monthlyNeededMinor: 150000, status: 'active' },
    });
    must(
      l.repos.transactions.create(
        l.transfer({ accountId: l.ids.cash, toAccountId: l.ids.bank, amountMinor: 5000 }),
      ),
    );
    expect(l.repos.goals.statuses()[0]?.progress?.savedMinor).toBe(105000);
  });

  it('validation and lifecycle', () => {
    const l = createLedger();
    expect(
      l.repos.goals.create({
        name: 'X',
        targetMinor: 100,
        targetDate: null,
        linkedAccountId: null,
      }),
    ).toEqual({ ok: false, error: ['account_required'] });
    expect(
      l.repos.goals.create({
        name: 'X',
        targetMinor: 100,
        targetDate: null,
        linkedAccountId: 'gone',
      }),
    ).toEqual({ ok: false, error: ['account_missing'] });
    const g = must(
      l.repos.goals.create({
        name: ' Trip ',
        targetMinor: 100,
        targetDate: null,
        linkedAccountId: l.ids.cash,
      }),
    );
    expect(g.name).toBe('Trip');
    must(
      l.repos.goals.update(g.id, {
        name: 'Trip',
        targetMinor: 6000,
        targetDate: null,
        linkedAccountId: l.ids.cash,
      }),
    );
    expect(l.repos.goals.statuses()[0]?.progress).toMatchObject({ status: 'no_date', percent: 83 });
    expect(l.repos.goals.delete(g.id)).toBe(true);
    expect(l.repos.goals.statuses()).toEqual([]);
  });
});

describe('notifications are best effort', () => {
  it('a crossing is recorded even when permission is denied (no re-fire after granting)', async () => {
    const l = createLedger();
    foodBudget(l);
    const n = fakeNotifications('denied');
    const { planning } = planningFor(l, n);
    spend(l, 32000);
    expect((await planning.afterWrite()).map((a) => a.threshold)).toEqual([80]);
    expect(n.presented).toEqual([]);
    n.permission = 'granted';
    expect(await planning.afterWrite()).toEqual([]);
  });
});
