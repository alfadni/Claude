import { monthOf, type DecimalRate } from '@/domain';
import { exportTransactionsCsv } from '@/services/csv/export';
import { runRecurrenceEngine } from '@/services/planning/recurrence-engine';

import { createLedger, must, type Ledger } from '../helpers/ledger';
import { seedLargeLedger } from '../helpers/seed';

/**
 * Phase 5 performance gate on the spec's 73k-row ledger. Time budgets are
 * deliberately loose (CI machines vary; phones are slower still): they catch
 * order-of-magnitude regressions. Query-plan checks are exact.
 */
let l: Ledger;
beforeAll(() => {
  l = createLedger();
  const seeded = seedLargeLedger(l);
  expect(seeded.transactions).toBe(73_000);
});

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
}

function plan(sql: string, params: (string | number)[]): string {
  return l.sql
    .all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
    .map((r) => r.detail)
    .join(' | ');
}

describe('query plans use indexes (no full scans of transactions)', () => {
  it.each([
    [
      'account balance',
      `SELECT sum(amount_minor) FROM transactions t WHERE t.account_id = ? AND t.deleted_at IS NULL
         AND t.status = 'posted' AND t.occurred_on <= ?`,
      ['a', '2026-10-15'],
      /USING COVERING INDEX transactions_balance_from/,
    ],
    [
      'incoming transfers',
      `SELECT sum(to_amount_minor) FROM transactions t WHERE t.to_account_id = ? AND t.deleted_at IS NULL
         AND t.status = 'posted' AND t.occurred_on <= ?`,
      ['a', '2026-10-15'],
      /USING COVERING INDEX transactions_balance_to/,
    ],
    [
      'month totals',
      `SELECT sum(base_amount_minor) FROM transactions t WHERE t.deleted_at IS NULL AND t.status = 'posted'
         AND t.type <> 'transfer' AND t.occurred_on >= ? AND t.occurred_on < ?`,
      ['2026-10-01', '2026-11-01'],
      /USING INDEX transactions_occurred_on/,
    ],
    [
      'transactions list page',
      `SELECT id FROM transactions t WHERE t.status = 'posted' AND t.deleted_at IS NULL
         ORDER BY t.occurred_at DESC, t.id DESC LIMIT 50`,
      [],
      /USING INDEX transactions_occurred_at/,
    ],
    [
      'recent categories window',
      `SELECT id FROM transactions WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 300`,
      [],
      /USING INDEX transactions_created/,
    ],
  ])('%s', (_name, sql, params, expected) => {
    const p = plan(sql, params);
    expect(p).toMatch(expected);
    expect(p).not.toMatch(/SCAN t(ransactions)?( |$)(?!USING)/);
  });
});

describe('time budgets on 73k rows', () => {
  it('home and list read models stay interactive', () => {
    const today = l.repos.today();
    const month = monthOf(today);
    const reads: [string, () => unknown, number][] = [
      ['list page', () => l.repos.transactions.list({}, null, 50), 50],
      ['text search', () => l.repos.transactions.list({ text: 'note 7' }, null, 50), 150],
      [
        'category filter',
        () => l.repos.transactions.list({ categoryIds: [l.ids.kids] }, null, 50),
        150,
      ],
      ['day summaries', () => l.repos.reports.daySummaries(month), 50],
      ['period totals', () => l.repos.reports.periodTotals(month, today), 50],
      ['category totals', () => l.repos.reports.categoryTotals(month, 'expense'), 50],
      ['12-month trend', () => l.repos.reports.monthlyTotals(month, 12, today), 100],
      ['month-over-month', () => l.repos.reports.categoryComparison(month, 'expense', today), 100],
      ['top payees', () => l.repos.reports.topPayees(month, 5, today), 50],
      ['balances', () => l.repos.accounts.balances(today), 100],
      ['net worth', () => l.repos.reports.netWorth(today), 100],
      ['recent categories', () => l.repos.categories.recentIds('expense'), 100],
      ['pending inbox', () => l.repos.transactions.listPending(), 50],
    ];
    for (const [name, read, budgetMs] of reads) {
      read(); // warm the statement cache, as a second render would
      const { ms } = timed(read);
      expect([name, ms < budgetMs]).toEqual([name, true]);
    }
  });

  it('budgets and the engine on a full ledger', () => {
    must(
      l.repos.budgets.create({
        categoryId: l.ids.food,
        period: 'monthly',
        amountMinor: 100000,
        rollover: true,
        thresholds: [80],
      }),
    );
    expect(timed(() => l.repos.budgets.statuses()).ms).toBeLessThan(100);
    expect(timed(() => l.repos.budgets.recordCrossings()).ms).toBeLessThan(200);
    expect(
      timed(() => runRecurrenceEngine({ ...l, repos: l.repos }, l.repos.today())).ms,
    ).toBeLessThan(100);
  });

  it('CSV export of everything', () => {
    const { value, ms } = timed(() => exportTransactionsCsv(l.sql, (c) => c.name));
    expect(value.split('\n').length).toBeGreaterThan(73_000);
    expect(ms).toBeLessThan(5000);
  });

  it('J10 base-currency change: preview is instant, apply rewrites 73k rows in one transaction', () => {
    const rates = new Map([['USD' as const, '600' as DecimalRate]]);
    expect(timed(() => l.repos.baseCurrency.requiredRates('SDG')).ms).toBeLessThan(200);
    const preview = timed(() => must(l.repos.baseCurrency.preview('SDG', rates)));
    expect(preview.ms).toBeLessThan(300);
    const apply = timed(() => must(l.repos.baseCurrency.apply('SDG', rates)));
    expect(apply.value.transactions).toBe(73_000);
    expect(apply.ms).toBeLessThan(15_000);
    // Preview promised exactly what apply wrote.
    const today = l.repos.today();
    expect(l.repos.reports.periodTotals(monthOf(today), today)).toMatchObject(preview.value.after);
  });
});
