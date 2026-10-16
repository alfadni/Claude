import { integrityReport } from '@/data/integrity';
import { auditLog } from '@/data/schema';
import { localDate, monthOf, parseRate, type DecimalRate } from '@/domain';

import { createLedger, must } from '../../helpers/ledger';

const today = localDate('2026-10-15'); // clock: 2026-10-15T09:00Z → Khartoum 11:00

describe('J2 add expense (data layer)', () => {
  it('saves, updates day markers and totals immediately', () => {
    const l = createLedger();
    const r = l.repos.transactions.create(l.expense());
    expect(r).toEqual({ ok: true, value: { id: expect.any(String), warnings: [] } });
    const month = monthOf(today);
    expect(l.repos.reports.daySummaries(month)).toEqual([
      { date: today, incomeMinor: 0, expenseMinor: 1250 },
    ]);
    expect(l.repos.reports.periodTotals(month, today)).toMatchObject({
      expenseMinor: 1250,
      spentSoFarMinor: 1250,
    });
    expect(l.repos.accounts.balances(today).get(l.ids.cash)).toBe(5000 - 1250);
    expect(integrityReport(l.sql).ok).toBe(true);
  });

  it('remembers the account as the quick-add default', () => {
    const l = createLedger();
    must(l.repos.transactions.create(l.expense({ accountId: l.ids.bank })));
    expect(l.repos.settings.get('lastAccountId')).toBe(l.ids.bank);
  });

  it('puts recent categories first', () => {
    const l = createLedger();
    must(
      l.repos.transactions.create(
        l.expense({ splits: [{ categoryId: l.ids.kids, amountMinor: 1250 }] }),
      ),
    );
    l.tick();
    must(l.repos.transactions.create(l.expense()));
    expect(l.repos.categories.recentIds('expense')).toEqual([l.ids.food, l.ids.kids]);
  });

  it.each([0, -100, 1e15])('rejects amount %p and writes nothing', (amountMinor) => {
    const l = createLedger();
    const r = l.repos.transactions.create(
      l.expense({ amountMinor, splits: [{ categoryId: l.ids.food, amountMinor }] }),
    );
    expect(r.ok).toBe(false);
    expect(l.sql.all('SELECT * FROM transactions')).toEqual([]);
  });

  it('future date: saved, labelled scheduled, excluded from spent so far and balance', () => {
    const l = createLedger();
    const r = l.repos.transactions.create(
      l.expense({ occurredOn: localDate('2026-10-20'), occurredAt: Date.UTC(2026, 9, 20) }),
    );
    expect(r).toMatchObject({ ok: true, value: { warnings: ['scheduled'] } });
    expect(l.repos.reports.periodTotals(monthOf(today), today)).toMatchObject({
      expenseMinor: 1250,
      spentSoFarMinor: 0,
      scheduledExpenseMinor: 1250,
    });
    expect(l.repos.accounts.balances(today).get(l.ids.cash)).toBe(5000);
  });

  it('date before account opening: warning, still saved', () => {
    const l = createLedger();
    const acc = must(
      l.repos.accounts.create({
        name: 'New',
        type: 'bank',
        currency: 'USD',
        openingBalanceMinor: 0,
        openedOn: localDate('2026-10-01'),
        includeInTotals: true,
      }),
    );
    const r = l.repos.transactions.create(
      l.expense({ accountId: acc.id, occurredOn: localDate('2026-09-30') }),
    );
    expect(r).toMatchObject({ ok: true, value: { warnings: ['before_account_opening'] } });
  });

  it('stores note, payee (deduplicated) and tags', () => {
    const l = createLedger();
    const a = must(
      l.repos.transactions.create(
        l.expense({ note: ' lunch ', payeeName: 'Al Amin', tagNames: ['#work', 'Work'] }),
      ),
    );
    const b = must(l.repos.transactions.create(l.expense({ payeeName: '  al  amin ' })));
    const da = l.repos.transactions.get(a.id);
    expect(da?.note).toBe('lunch');
    expect(da?.tags.map((t) => t.name)).toEqual(['work']);
    expect(l.repos.transactions.get(b.id)?.payeeId).toBe(da?.payeeId);
    expect(l.repos.names.searchPayees('al')).toEqual([{ id: da?.payeeId, name: 'Al Amin' }]);
  });

  it('foreign-currency account: requires a rate, freezes the base amount, remembers the rate', () => {
    const l = createLedger();
    const sdg = must(
      l.repos.accounts.create({
        name: 'Bankak',
        type: 'mobile_wallet',
        currency: 'SDG',
        openingBalanceMinor: 0,
        openedOn: null,
        includeInTotals: true,
      }),
    );
    const noRate = l.repos.transactions.create(
      l.expense({
        accountId: sdg.id,
        amountMinor: 600000,
        splits: [{ categoryId: l.ids.food, amountMinor: 600000 }],
      }),
    );
    expect(noRate).toEqual({ ok: false, error: ['fx_rate_required'] });
    const rate = (parseRate('0.001666') as { value: DecimalRate }).value;
    const r = must(
      l.repos.transactions.create(
        l.expense({
          accountId: sdg.id,
          amountMinor: 600000,
          fxRateToBase: rate,
          splits: [{ categoryId: l.ids.food, amountMinor: 600000 }],
        }),
      ),
    );
    const row = l.repos.transactions.get(r.id);
    expect(row).toMatchObject({ currency: 'SDG', baseAmountMinor: 1000, fxRateToBase: '0.001666' });
    expect(l.repos.fx.latest('SDG', 'USD')).toBe('0.001666');
    expect(l.repos.fx.latest('USD', 'SDG')).toBe('600.240096038415');
  });

  it('every write is audited', () => {
    const l = createLedger();
    const before = l.db.select().from(auditLog).all().length;
    must(l.repos.transactions.create(l.expense()));
    const rows = l.db.select().from(auditLog).all().slice(before);
    expect(rows.map((r) => r.entity)).toContain('transactions');
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1); // one user action = one batch
  });
});

describe('J3 split transaction (data layer)', () => {
  it('$123 = Clothes 80 + Kids 43: category reports reflect each part', () => {
    const l = createLedger();
    must(
      l.repos.transactions.create(
        l.expense({
          amountMinor: 12300,
          splits: [
            { categoryId: l.ids.clothes, amountMinor: 8000 },
            { categoryId: l.ids.kids, amountMinor: 4300 },
          ],
        }),
      ),
    );
    expect(l.repos.reports.categoryTotals(monthOf(today), 'expense')).toEqual([
      { categoryId: l.ids.clothes, totalMinor: 8000, share: 8000 / 12300 },
      { categoryId: l.ids.kids, totalMinor: 4300, share: 4300 / 12300 },
    ]);
    expect(integrityReport(l.sql).ok).toBe(true);
  });

  it('blocks splits that do not sum to the total', () => {
    const l = createLedger();
    const r = l.repos.transactions.create(
      l.expense({
        amountMinor: 12300,
        splits: [
          { categoryId: l.ids.clothes, amountMinor: 8000 },
          { categoryId: l.ids.kids, amountMinor: 4000 },
        ],
      }),
    );
    expect(r).toEqual({ ok: false, error: ['split_sum_mismatch'] });
    expect(l.sql.all('SELECT * FROM transactions')).toEqual([]);
  });

  it('editing a split back to one category replaces the splits', () => {
    const l = createLedger();
    const { id } = must(
      l.repos.transactions.create(
        l.expense({
          amountMinor: 12300,
          splits: [
            { categoryId: l.ids.clothes, amountMinor: 8000 },
            { categoryId: l.ids.kids, amountMinor: 4300 },
          ],
        }),
      ),
    );
    l.tick();
    must(
      l.repos.transactions.update(
        id,
        l.expense({
          amountMinor: 12300,
          splits: [{ categoryId: l.ids.clothes, amountMinor: 12300 }],
        }),
      ),
    );
    expect(l.repos.transactions.get(id)?.splits.map((s) => [s.categoryId, s.amountMinor])).toEqual([
      [l.ids.clothes, 12300],
    ]);
    expect(l.repos.reports.categoryTotals(monthOf(today), 'expense')).toHaveLength(1);
    expect(integrityReport(l.sql).ok).toBe(true);
  });
});

describe('J4 transfer between accounts (data layer)', () => {
  it('net worth lists foreign accounts without any known rate', () => {
    const l = createLedger();
    const eur = must(
      l.repos.accounts.create({
        name: 'Euro',
        type: 'bank',
        currency: 'EUR',
        openingBalanceMinor: 100,
        openedOn: null,
        includeInTotals: true,
      }),
    );
    expect(l.repos.reports.netWorth(today)).toEqual({
      currency: 'USD',
      totalMinor: 105000,
      missingRateAccountIds: [eur.id],
    });
  });

  it('Bank → Cash 100 USD moves both balances and is not income or expense', () => {
    const l = createLedger();
    must(l.repos.transactions.create(l.transfer()));
    const b = l.repos.accounts.balances(today);
    expect(b.get(l.ids.bank)).toBe(100000 - 10000);
    expect(b.get(l.ids.cash)).toBe(5000 + 10000);
    expect(l.repos.reports.periodTotals(monthOf(today), today)).toMatchObject({
      incomeMinor: 0,
      expenseMinor: 0,
    });
    expect(l.repos.reports.daySummaries(monthOf(today))).toEqual([]);
    expect(l.repos.reports.netWorth(today).totalMinor).toBe(105000);
  });

  it('USD bank → SDG wallet: both amounts stored, rate derived and remembered', () => {
    const l = createLedger();
    const sdg = must(
      l.repos.accounts.create({
        name: 'Wallet',
        type: 'mobile_wallet',
        currency: 'SDG',
        openingBalanceMinor: 0,
        openedOn: null,
        includeInTotals: true,
      }),
    );
    const { id } = must(
      l.repos.transactions.create(
        l.transfer({ toAccountId: sdg.id, amountMinor: 10000, toAmountMinor: 6005000 }),
      ),
    );
    expect(l.repos.transactions.get(id)).toMatchObject({
      amountMinor: 10000,
      currency: 'USD',
      toAmountMinor: 6005000,
      toCurrency: 'SDG',
      baseAmountMinor: 10000,
    });
    expect(l.repos.accounts.balances(today).get(sdg.id)).toBe(6005000);
    // The transfer implied 1 SDG = 0.001665… USD, so net worth can include the wallet.
    expect(l.repos.fx.latest('SDG', 'USD')).toBe('0.001665278934');
    expect(l.repos.reports.netWorth(today)).toEqual({
      currency: 'USD',
      totalMinor: 105000,
      missingRateAccountIds: [],
    });
  });

  it('SDG wallet → USD bank derives the rate from the two legs', () => {
    const l = createLedger();
    const sdg = must(
      l.repos.accounts.create({
        name: 'Wallet',
        type: 'mobile_wallet',
        currency: 'SDG',
        openingBalanceMinor: 6005000,
        openedOn: null,
        includeInTotals: true,
      }),
    );
    const { id } = must(
      l.repos.transactions.create(
        l.transfer({
          accountId: sdg.id,
          toAccountId: l.ids.bank,
          amountMinor: 6005000,
          toAmountMinor: 10000,
        }),
      ),
    );
    expect(l.repos.transactions.get(id)).toMatchObject({
      baseAmountMinor: 10000,
      fxRateToBase: '0.001665278934',
    });
    expect(l.repos.fx.latest('SDG', 'USD')).toBe('0.001665278934');
    expect(l.repos.reports.netWorth(today).missingRateAccountIds).toEqual([]);
  });

  it('same source and destination is blocked', () => {
    const l = createLedger();
    expect(l.repos.transactions.create(l.transfer({ toAccountId: l.ids.bank }))).toEqual({
      ok: false,
      error: ['same_account'],
    });
  });

  it('transfer from an archived account is blocked', () => {
    const l = createLedger();
    l.repos.accounts.setArchived(l.ids.bank, true);
    expect(l.repos.transactions.create(l.transfer())).toEqual({
      ok: false,
      error: ['account_archived'],
    });
  });

  it('insufficient balance: warning only', () => {
    const l = createLedger();
    const r = l.repos.transactions.create(
      l.transfer({ accountId: l.ids.cash, toAccountId: l.ids.bank, amountMinor: 999999 }),
    );
    expect(r).toMatchObject({ ok: true, value: { warnings: ['insufficient_balance'] } });
    expect(l.repos.accounts.balances(today).get(l.ids.cash)).toBe(5000 - 999999);
  });
});

describe('J7 edit / delete / undo (data layer)', () => {
  function seeded() {
    const l = createLedger();
    const { id } = must(
      l.repos.transactions.create(
        l.expense({
          amountMinor: 12300,
          note: 'T-shirt, pants',
          payeeName: 'Souq',
          tagNames: ['eid'],
          splits: [
            { categoryId: l.ids.clothes, amountMinor: 8000 },
            { categoryId: l.ids.kids, amountMinor: 4300 },
          ],
        }),
      ),
    );
    l.repos.attachments.insert({
      id: 'att-1',
      transactionId: id,
      filePath: 'attachments/att-1.bin',
      mime: 'image/jpeg',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
    });
    return { l, id };
  }

  it('delete then undo restores exactly: splits, tags, payee, attachments', () => {
    const { l, id } = seeded();
    const before = l.repos.transactions.get(id);
    l.tick();
    must(l.repos.transactions.delete(id));
    expect(l.repos.transactions.get(id)?.deletedAt).not.toBeNull();
    expect(l.repos.reports.periodTotals(monthOf(today), today).expenseMinor).toBe(0);
    expect(l.repos.transactions.list({}, null)).toEqual([]);
    l.tick();
    must(l.repos.transactions.restore(id));
    const after = l.repos.transactions.get(id);
    const strip = (d: typeof before) => ({
      ...d,
      updatedAt: 0,
      version: 0,
      splits: d?.splits.map((s) => ({ ...s, updatedAt: 0 })),
      attachments: d?.attachments.map((a) => ({ ...a, updatedAt: 0 })),
    });
    expect(strip(after)).toEqual(strip(before));
    expect(integrityReport(l.sql).ok).toBe(true);
  });

  it('restore does not resurrect splits replaced by an earlier edit', () => {
    const { l, id } = seeded();
    l.tick();
    must(
      l.repos.transactions.update(
        id,
        l.expense({
          amountMinor: 12300,
          splits: [{ categoryId: l.ids.clothes, amountMinor: 12300 }],
        }),
      ),
    );
    l.tick();
    must(l.repos.transactions.delete(id));
    l.tick();
    must(l.repos.transactions.restore(id));
    expect(l.repos.transactions.get(id)?.splits).toHaveLength(1);
    expect(integrityReport(l.sql).ok).toBe(true);
  });

  it('undo window missed: item is in Trash for 30 days, then purged with its files and history', () => {
    const { l, id } = seeded();
    l.tick();
    must(l.repos.transactions.delete(id));
    expect(l.repos.transactions.listTrash().map((t) => t.id)).toEqual([id]);
    l.tick(29 * 86_400_000);
    expect(l.repos.transactions.purgeExpired()).toEqual({ purged: 0, filePaths: [] });
    expect(l.repos.transactions.listTrash()).toHaveLength(1);
    l.tick(2 * 86_400_000);
    expect(l.repos.transactions.listTrash()).toHaveLength(0);
    expect(l.repos.transactions.purgeExpired()).toEqual({
      purged: 1,
      filePaths: ['attachments/att-1.bin'],
    });
    expect(l.repos.transactions.get(id)).toBeUndefined();
    expect(l.sql.all('SELECT * FROM transaction_splits')).toEqual([]);
    const history = l.sql.all<{ action: string; before_json: string | null }>(
      `SELECT action, before_json FROM audit_log WHERE entity = 'transactions' AND entity_id = ?`,
      [id],
    );
    expect(history).toEqual([{ action: 'purge', before_json: null }]);
  });

  it('deleting twice / restoring a live item are rejected', () => {
    const { l, id } = seeded();
    expect(l.repos.transactions.restore(id)).toEqual({ ok: false, error: 'not_deleted' });
    must(l.repos.transactions.delete(id));
    expect(l.repos.transactions.delete(id)).toEqual({ ok: false, error: 'not_found' });
    expect(l.repos.transactions.restore('missing')).toEqual({ ok: false, error: 'not_found' });
  });

  it('editing a recurring-generated transaction requires a scope; "this and future" updates the rule', () => {
    const { l, id } = seeded();
    l.sql.run(
      `INSERT INTO recurring_rules (id, created_at, updated_at, rrule, tz, template_json, mode, starts_on) VALUES ('rule',1,1,'FREQ=MONTHLY','UTC','{"amountMinor":12300}','auto_post','2026-01-01')`,
    );
    l.sql.run(
      `UPDATE transactions SET recurring_rule_id = 'rule', recurrence_key = 'rule:2026-10-15' WHERE id = ?`,
      [id],
    );
    const edit = l.expense({
      amountMinor: 15000,
      splits: [{ categoryId: l.ids.clothes, amountMinor: 15000 }],
    });
    expect(l.repos.transactions.update(id, edit)).toEqual({ ok: false, error: ['scope_required'] });

    l.tick();
    must(l.repos.transactions.update(id, edit, 'this_only'));
    const ruleAfterOnly = l.sql.all<{ t: string }>(
      `SELECT template_json AS t FROM recurring_rules`,
    )[0];
    expect(JSON.parse(ruleAfterOnly?.t ?? '{}').amountMinor).toBe(12300);

    l.tick();
    must(
      l.repos.transactions.update(
        id,
        {
          ...edit,
          amountMinor: 16000,
          splits: [{ categoryId: l.ids.clothes, amountMinor: 16000 }],
        },
        'this_and_future',
      ),
    );
    const rule = l.sql.all<{ t: string; v: number }>(
      `SELECT template_json AS t, version AS v FROM recurring_rules`,
    )[0];
    expect(JSON.parse(rule?.t ?? '{}').amountMinor).toBe(16000);
    expect(rule?.v).toBe(2);
  });

  it('editing keeps archived categories already on the transaction', () => {
    const { l, id } = seeded();
    l.repos.categories.setArchived(l.ids.kids, true);
    l.tick();
    const r = l.repos.transactions.update(
      id,
      l.expense({
        amountMinor: 12300,
        splits: [
          { categoryId: l.ids.clothes, amountMinor: 8000 },
          { categoryId: l.ids.kids, amountMinor: 4300 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    // ...but a new transaction can't pick the archived category
    expect(
      l.repos.transactions.create(
        l.expense({ splits: [{ categoryId: l.ids.kids, amountMinor: 1250 }] }),
      ),
    ).toEqual({
      ok: false,
      error: ['category_archived'],
    });
  });

  it('update of a missing or deleted transaction is rejected', () => {
    const { l, id } = seeded();
    expect(l.repos.transactions.update('nope', l.expense())).toEqual({
      ok: false,
      error: ['not_found'],
    });
    must(l.repos.transactions.delete(id));
    expect(l.repos.transactions.update(id, l.expense())).toEqual({
      ok: false,
      error: ['not_found'],
    });
  });
});

describe('transaction list: search, filters, pagination (spec 5.4)', () => {
  function many() {
    const l = createLedger();
    must(
      l.repos.transactions.create(
        l.expense({
          note: 'Coffee 50% off',
          amountMinor: 450,
          splits: [{ categoryId: l.ids.food, amountMinor: 450 }],
        }),
      ),
    );
    l.tick();
    must(
      l.repos.transactions.create(
        l.expense({
          payeeName: 'Zain',
          amountMinor: 1250,
          accountId: l.ids.bank,
          tagNames: ['phone'],
        }),
      ),
    );
    l.tick();
    must(l.repos.transactions.create(l.income({ amountMinor: 300000, note: 'October salary' })));
    l.tick();
    must(l.repos.transactions.create(l.transfer()));
    return l;
  }

  it('lists newest first', () => {
    const l = many();
    expect(l.repos.transactions.list({}, null).map((r) => r.type)).toEqual([
      'transfer',
      'income',
      'expense',
      'expense',
    ]);
  });

  it('searches note, payee and amount', () => {
    const l = many();
    expect(l.repos.transactions.list({ text: 'coffee' }, null).map((r) => r.amountMinor)).toEqual([
      450,
    ]);
    expect(l.repos.transactions.list({ text: 'zain' }, null).map((r) => r.payeeName)).toEqual([
      'Zain',
    ]);
    expect(
      l.repos.transactions
        .list({ text: '12.5', amountsMinor: [1250, 12500] }, null)
        .map((r) => r.amountMinor),
    ).toEqual([1250]);
    expect(l.repos.transactions.list({ text: '50%' }, null)).toHaveLength(1); // literal %, not wildcard
    expect(l.repos.transactions.list({ text: '%' }, null)).toHaveLength(1);
  });

  it('filters by type, account (either leg), category, tag and date', () => {
    const l = many();
    expect(l.repos.transactions.list({ types: ['income'] }, null)).toHaveLength(1);
    expect(
      l.repos.transactions.list({ accountIds: [l.ids.bank] }, null).map((r) => r.type),
    ).toEqual(['transfer', 'expense']);
    expect(l.repos.transactions.list({ categoryIds: [l.ids.food] }, null)).toHaveLength(2);
    const tag = l.repos.names.listTags()[0];
    expect(l.repos.transactions.list({ tagIds: [tag?.id ?? ''] }, null)).toHaveLength(1);
    expect(l.repos.transactions.list({ from: localDate('2026-10-16') }, null)).toHaveLength(0);
    expect(l.repos.transactions.list({ from: today, to: today }, null)).toHaveLength(4);
  });

  it('paginates with a stable cursor', () => {
    const l = many();
    const page1 = l.repos.transactions.list({}, null, 2);
    const last = page1[page1.length - 1];
    const page2 = l.repos.transactions.list(
      {},
      last ? { occurredAt: last.occurredAt, id: last.id } : null,
      2,
    );
    expect([...page1, ...page2].map((r) => r.id)).toEqual(
      l.repos.transactions.list({}, null).map((r) => r.id),
    );
  });
});
