import { localDate, monthOf, type DecimalRate } from '@/domain';

import { createLedger, must, type Ledger } from '../../helpers/ledger';
import { setDay } from '../../helpers/planning';

const d = (s: string) => localDate(s);
const r = (s: string) => s as DecimalRate;

function eurAccount(l: Ledger) {
  return must(
    l.repos.accounts.create({
      name: 'Euro',
      type: 'bank',
      currency: 'EUR',
      openingBalanceMinor: 0,
      openedOn: null,
      includeInTotals: true,
    }),
  ).id;
}

function txRows(l: Ledger) {
  return l.sql.all<{
    id: string;
    amount_minor: number;
    currency: string;
    base_amount_minor: number;
    fx_rate_to_base: string;
  }>(
    'SELECT id, amount_minor, currency, base_amount_minor, fx_rate_to_base FROM transactions ORDER BY created_at',
  );
}

describe('J10 change base currency', () => {
  it('✅ USD → SDG with a rate: preview, confirm, base amounts recomputed, originals untouched', () => {
    const l = createLedger();
    must(l.repos.transactions.create(l.expense({ amountMinor: 1250 })));
    must(l.repos.transactions.create(l.income({ amountMinor: 300000 })));
    const before = txRows(l);
    const bc = l.repos.baseCurrency;

    expect(bc.requiredRates('SDG')).toEqual([
      { currency: 'USD', suggested: null, transactions: 2, budgets: 0 },
    ]);
    const rates = new Map([['USD' as const, r('600.5')]]);
    const preview = must(bc.preview('SDG', rates));
    expect(preview).toMatchObject({
      from: 'USD',
      to: 'SDG',
      transactions: 2,
      before: { incomeMinor: 300000, expenseMinor: 1250 },
      // 12.50 USD * 600.5 = 7,506.25 SDG; 3,000 USD = 1,801,500 SDG
      after: { incomeMinor: 180150000, expenseMinor: 750625 },
    });
    // Preview writes nothing.
    expect(txRows(l)).toEqual(before);
    expect(l.repos.settings.get('baseCurrency')).toBe('USD');

    must(bc.apply('SDG', rates));
    const after = txRows(l);
    expect(after.map((t) => [t.amount_minor, t.currency])).toEqual(
      before.map((t) => [t.amount_minor, t.currency]),
    );
    expect(after.map((t) => [t.base_amount_minor, t.fx_rate_to_base])).toEqual([
      [750625, '600.5'],
      [180150000, '600.5'],
    ]);
    expect(l.repos.settings.get('baseCurrency')).toBe('SDG');
    // Reports now speak SDG and match the preview exactly.
    const totals = l.repos.reports.periodTotals(monthOf(l.repos.today()), l.repos.today());
    expect(totals).toMatchObject(preview.after);
    expect(l.repos.fx.latest('USD', 'SDG')).toBe('600.5');
  });

  it('❌ a currency in history has no rate → blocked, nothing changes', () => {
    const l = createLedger();
    const eur = eurAccount(l);
    must(
      l.repos.transactions.create(
        l.expense({ accountId: eur, fxRateToBase: r('1.1'), amountMinor: 1000 }),
      ),
    );
    must(l.repos.transactions.create(l.expense()));
    const req = l.repos.baseCurrency.requiredRates('SDG');
    // EUR was recorded against USD only, so there is no EUR→SDG suggestion.
    expect(req.map((x) => [x.currency, x.suggested])).toEqual([
      ['EUR', null],
      ['USD', null],
    ]);
    const onlyUsd = new Map([['USD' as const, r('600')]]);
    expect(l.repos.baseCurrency.preview('SDG', onlyUsd)).toEqual({
      ok: false,
      error: { code: 'rates_missing', currencies: ['EUR'] },
    });
    const before = txRows(l);
    expect(l.repos.baseCurrency.apply('SDG', onlyUsd).ok).toBe(false);
    expect(txRows(l)).toEqual(before);
    expect(l.repos.settings.get('baseCurrency')).toBe('USD');
  });

  it('suggests rates from the FX table (direct or inverted); same currency is refused', () => {
    const l = createLedger();
    const eur = eurAccount(l);
    must(
      l.repos.transactions.create(
        l.expense({ accountId: eur, fxRateToBase: r('1.25'), amountMinor: 1000 }),
      ),
    );
    must(l.repos.transactions.create(l.expense({ amountMinor: 500 })));
    // Switching to EUR: only the USD row needs a rate; the table holds EUR→USD 1.25, so 0.8.
    expect(l.repos.baseCurrency.requiredRates('EUR')).toEqual([
      { currency: 'USD', suggested: '0.8', transactions: 1, budgets: 0 },
    ]);
    expect(l.repos.baseCurrency.preview('USD', new Map())).toEqual({
      ok: false,
      error: { code: 'same_currency' },
    });
  });

  it('transfers into the new base use their received leg; splits still sum exactly', () => {
    const l = createLedger();
    const eur = eurAccount(l);
    // USD bank → EUR account: 100.00 USD sent, 92.00 EUR received.
    must(
      l.repos.transactions.create(
        l.transfer({
          accountId: l.ids.bank,
          toAccountId: eur,
          amountMinor: 10000,
          toAmountMinor: 9200,
        }),
      ),
    );
    // A 3-way split in USD with awkward cents.
    must(
      l.repos.transactions.create(
        l.expense({
          amountMinor: 1000,
          splits: [
            { categoryId: l.ids.food, amountMinor: 333 },
            { categoryId: l.ids.kids, amountMinor: 333 },
            { categoryId: l.ids.clothes, amountMinor: 334 },
          ],
        }),
      ),
    );
    must(l.repos.baseCurrency.apply('EUR', new Map([['USD' as const, r('0.917')]])));
    const [transfer, split] = txRows(l);
    expect(transfer?.base_amount_minor).toBe(9200); // the EUR leg, not 100 * 0.917
    expect(split?.base_amount_minor).toBe(917);
    const sums = l.sql.all<{ s: number }>(
      'SELECT sum(base_amount_minor) AS s FROM transaction_splits WHERE transaction_id = ? AND deleted_at IS NULL',
      [split?.id as string],
    );
    expect(sums[0]?.s).toBe(917);
  });

  it('budgets convert to the new base; trashed and pending rows are recomputed too', () => {
    const l = createLedger();
    must(
      l.repos.budgets.create({
        categoryId: l.ids.food,
        period: 'monthly',
        amountMinor: 40000,
        rollover: false,
        thresholds: [80],
      }),
    );
    const id = must(l.repos.transactions.create(l.expense({ amountMinor: 1000 }))).id;
    must(l.repos.transactions.delete(id));
    expect(l.repos.baseCurrency.requiredRates('SDG')).toEqual([
      { currency: 'USD', suggested: null, transactions: 1, budgets: 1 },
    ]);
    must(l.repos.baseCurrency.apply('SDG', new Map([['USD' as const, r('600')]])));
    expect(l.repos.budgets.list()[0]).toMatchObject({ amountMinor: 24000000, currency: 'SDG' });
    must(l.repos.transactions.restore(id));
    expect(
      l.repos.reports.periodTotals(monthOf(l.repos.today()), l.repos.today()).expenseMinor,
    ).toBe(600000);
    expect(l.repos.budgets.statuses()[0]?.evaluation).toMatchObject({
      spentMinor: 600000,
      percent: 2,
    });
  });

  it('recurring templates drop their old-base fallback rate', () => {
    const l = createLedger();
    const eur = eurAccount(l);
    const tx = must(
      l.repos.transactions.create(
        l.expense({
          accountId: eur,
          fxRateToBase: r('1.1'),
          amountMinor: 1000,
          occurredOn: d('2026-10-01'),
        }),
      ),
    );
    const rule = must(
      l.repos.recurring.createFromTransaction(tx.id, {
        pattern: { frequency: 'monthly', interval: 1, byMonthDay: 1 },
        mode: 'auto_post',
      }),
    );
    expect(rule.template.fxRateToBase).toBe('1.1');
    must(
      l.repos.baseCurrency.apply(
        'SDG',
        new Map([
          ['EUR' as const, r('650')],
          ['USD' as const, r('600')],
        ]),
      ),
    );
    expect(l.repos.recurring.get(rule.id)?.template.fxRateToBase).toBeNull();
  });

  it('is audited with one summary entry (no per-row copies)', () => {
    const l = createLedger();
    must(l.repos.transactions.create(l.expense()));
    must(l.repos.baseCurrency.apply('SDG', new Map([['USD' as const, r('600')]])));
    const audit = l.sql.all<{ after_json: string }>(
      `SELECT after_json FROM audit_log WHERE entity = 'settings' AND entity_id = 'baseCurrency'`,
    );
    // The settings repository logs the value change; the summary carries the rates and counts.
    const summary = audit
      .map((a) => JSON.parse(a.after_json) as unknown)
      .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      baseCurrency: 'SDG',
      rates: { USD: '600' },
      transactions: 1,
    });
  });
});

describe('FX table', () => {
  it('lists, replaces same-day rates and soft-deletes without touching history', () => {
    const l = createLedger();
    l.repos.fx.record('EUR', 'USD', r('1.1'), d('2026-10-01'));
    l.repos.fx.record('EUR', 'USD', r('1.12'), d('2026-10-01'));
    l.repos.fx.record('GBP', 'USD', r('1.3'), d('2026-10-10'));
    const list = l.repos.fx.list();
    expect(list.map((x) => [x.base, x.quote, x.rate, x.asOf])).toEqual([
      ['GBP', 'USD', '1.3', '2026-10-10'],
      ['EUR', 'USD', '1.12', '2026-10-01'],
    ]);
    const eur = eurAccount(l);
    const tx = must(
      l.repos.transactions.create(
        l.expense({ accountId: eur, fxRateToBase: r('1.12'), amountMinor: 1000 }),
      ),
    );
    expect(l.repos.fx.remove(list[1]?.id as string)).toBe(true);
    expect(l.repos.fx.remove(list[1]?.id as string)).toBe(false);
    expect(l.repos.fx.latest('EUR', 'USD', d('2026-10-05'))).toBeNull();
    expect(l.repos.transactions.get(tx.id)?.fxRateToBase).toBe('1.12');
  });
});

describe('reports read models (ADR-016)', () => {
  it('12-month trend; future-dated items excluded; empty months are zero', () => {
    const l = createLedger();
    must(
      l.repos.transactions.create(l.expense({ amountMinor: 1000, occurredOn: d('2026-09-10') })),
    );
    must(l.repos.transactions.create(l.income({ amountMinor: 5000, occurredOn: d('2026-10-01') })));
    must(l.repos.transactions.create(l.expense({ amountMinor: 700, occurredOn: d('2026-10-20') }))); // future
    must(l.repos.transactions.create(l.transfer()));
    const trend = l.repos.reports.monthlyTotals(monthOf(d('2026-10-15')), 12, l.repos.today());
    expect(trend).toHaveLength(12);
    expect(trend[0]?.month).toBe('2025-11-01');
    expect(trend.slice(-2)).toEqual([
      { month: '2026-09-01', incomeMinor: 0, expenseMinor: 1000 },
      { month: '2026-10-01', incomeMinor: 5000, expenseMinor: 0 },
    ]);
  });

  it('month-over-month per category, biggest change first', () => {
    const l = createLedger();
    const spend = (on: string, categoryId: string, amountMinor: number) =>
      must(
        l.repos.transactions.create(
          l.expense({ occurredOn: d(on), amountMinor, splits: [{ categoryId, amountMinor }] }),
        ),
      );
    spend('2026-09-05', l.ids.food, 10000);
    spend('2026-10-05', l.ids.food, 12000);
    spend('2026-09-07', l.ids.kids, 5000);
    spend('2026-10-07', l.ids.clothes, 3000);
    const rows = l.repos.reports.categoryComparison(
      monthOf(d('2026-10-01')),
      'expense',
      l.repos.today(),
    );
    expect(rows.map((x) => [x.categoryId, x.currentMinor, x.previousMinor, x.deltaMinor])).toEqual([
      [l.ids.kids, 0, 5000, -5000],
      [l.ids.clothes, 3000, 0, 3000],
      [l.ids.food, 12000, 10000, 2000],
    ]);
  });

  it('top payees by amount, then count', () => {
    const l = createLedger();
    const pay = (payeeName: string, amountMinor: number) =>
      must(l.repos.transactions.create(l.expense({ payeeName, amountMinor })));
    pay('Bakery', 500);
    pay('bakery ', 700); // same payee, normalised
    pay('Pharmacy', 1500);
    pay('Kiosk', 200);
    expect(l.repos.reports.topPayees(monthOf(l.repos.today()), 2, l.repos.today())).toEqual([
      { name: 'Pharmacy', totalMinor: 1500, count: 1 },
      { name: 'Bakery', totalMinor: 1200, count: 2 },
    ]);
  });

  it('pending recurring rows never appear in reports', () => {
    const l = createLedger();
    const tx = must(
      l.repos.transactions.create(l.expense({ occurredOn: d('2026-10-01'), payeeName: 'Rent Co' })),
    );
    must(
      l.repos.recurring.createFromTransaction(tx.id, {
        pattern: { frequency: 'monthly', interval: 1, byMonthDay: 1 },
        mode: 'confirm_before_post',
      }),
    );
    setDay(l, '2026-11-02');
    l.repos.transactions.createOccurrence({
      ruleId: l.repos.recurring.list().rules[0]?.id as string,
      date: d('2026-11-01'),
      timeZone: 'Africa/Khartoum',
      template: l.repos.recurring.list().rules[0]?.template as never,
      status: 'pending_recurring',
    });
    const nov = monthOf(d('2026-11-01'));
    expect(l.repos.reports.topPayees(nov, 5, l.repos.today())).toEqual([]);
    expect(l.repos.reports.monthlyTotals(nov, 1, l.repos.today())[0]?.expenseMinor).toBe(0);
  });
});
