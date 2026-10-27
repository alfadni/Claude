import { integrityReport } from '@/data/integrity';

import { createTestDb, type TestDb } from '../../helpers/sqlite';

/**
 * The database is the last line of defence: even if a repository has a bug,
 * these invariants cannot be violated.
 */
const NOW = 1_760_000_000_000;

function seed(t: TestDb) {
  const ins = (sql: string, params: (string | number | null)[]) => t.sql.run(sql, params);
  const common = (id: string) => [id, NOW, NOW];
  ins(
    `INSERT INTO accounts (id, created_at, updated_at, name, type, currency) VALUES (?,?,?,?,?,?)`,
    [...common('acc-cash'), 'Cash', 'cash', 'USD'],
  );
  ins(
    `INSERT INTO accounts (id, created_at, updated_at, name, type, currency) VALUES (?,?,?,?,?,?)`,
    [...common('acc-bank'), 'Bank', 'bank', 'USD'],
  );
  ins(`INSERT INTO categories (id, created_at, updated_at, name, kind) VALUES (?,?,?,?,?)`, [
    ...common('cat-food'),
    'Food',
    'expense',
  ]);
}

const TX_COLS = `id, created_at, updated_at, type, account_id, to_account_id, amount_minor, currency,
  to_amount_minor, to_currency, fx_rate_to_base, base_amount_minor, occurred_at, occurred_tz, occurred_on`;

function insertTx(
  t: TestDb,
  over: Partial<
    Record<'id' | 'type' | 'to' | 'amount' | 'toAmount' | 'toCurrency' | 'on', unknown>
  > = {},
) {
  t.sql.run(`INSERT INTO transactions (${TX_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    (over.id as string) ?? 'tx-1',
    NOW,
    NOW,
    (over.type as string) ?? 'expense',
    'acc-cash',
    (over.to as string | null) ?? null,
    (over.amount as number) ?? 1000,
    'USD',
    (over.toAmount as number | null) ?? null,
    (over.toCurrency as string | null) ?? null,
    '1',
    (over.amount as number) ?? 1000,
    NOW,
    'Africa/Khartoum',
    (over.on as string) ?? '2026-10-15',
  ]);
}

describe('table constraints', () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seed(t);
  });

  it('accepts a valid expense', () => {
    expect(() => insertTx(t)).not.toThrow();
  });

  it.each([
    ['zero amount', { amount: 0 }],
    ['negative amount', { amount: -5 }],
    ['float amount (STRICT tables reject REAL)', { amount: 10.5 }],
    ['expense with a destination account', { to: 'acc-bank' }],
    ['transfer without a destination', { type: 'transfer' }],
    [
      'transfer to the same account (J4)',
      { type: 'transfer', to: 'acc-cash', toAmount: 1000, toCurrency: 'USD' },
    ],
    ['transfer without second leg', { type: 'transfer', to: 'acc-bank' }],
    ['unknown type', { type: 'refund' }],
    ['malformed local date', { on: '15/10/2026' }],
  ])('rejects %s', (_label, over) => {
    expect(() => insertTx(t, over)).toThrow();
  });

  it('accepts a valid transfer', () => {
    expect(() =>
      insertTx(t, { type: 'transfer', to: 'acc-bank', toAmount: 1000, toCurrency: 'USD' }),
    ).not.toThrow();
  });

  it('enforces foreign keys', () => {
    expect(() =>
      t.sql.run(
        `INSERT INTO transaction_splits (id, created_at, updated_at, transaction_id, category_id, amount_minor) VALUES (?,?,?,?,?,?)`,
        ['s-1', NOW, NOW, 'missing-tx', 'cat-food', 100],
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it('rejects lowercase or malformed currency codes', () => {
    expect(() =>
      t.sql.run(
        `INSERT INTO accounts (id, created_at, updated_at, name, type, currency) VALUES (?,?,?,?,?,?)`,
        ['acc-x', NOW, NOW, 'X', 'cash', 'usd'],
      ),
    ).toThrow();
  });

  it('rejects blank account names', () => {
    expect(() =>
      t.sql.run(
        `INSERT INTO accounts (id, created_at, updated_at, name, type, currency) VALUES (?,?,?,?,?,?)`,
        ['acc-y', NOW, NOW, '   ', 'cash', 'USD'],
      ),
    ).toThrow();
  });

  it('makes recurrence keys unique (J5 idempotency)', () => {
    t.sql.run(
      `INSERT INTO recurring_rules (id, created_at, updated_at, rrule, tz, template_json, mode, starts_on) VALUES (?,?,?,?,?,?,?,?)`,
      ['rule-1', NOW, NOW, 'FREQ=MONTHLY;BYMONTHDAY=1', 'UTC', '{}', 'auto_post', '2026-01-01'],
    );
    const withKey = (id: string) =>
      t.sql.run(
        `INSERT INTO transactions (${TX_COLS}, recurring_rule_id, recurrence_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          NOW,
          NOW,
          'expense',
          'acc-cash',
          null,
          1000,
          'USD',
          null,
          null,
          '1',
          1000,
          NOW,
          'UTC',
          '2026-02-01',
          'rule-1',
          'rule-1:2026-02-01',
        ],
      );
    withKey('tx-a');
    expect(() => withKey('tx-b')).toThrow(/UNIQUE/);
  });

  it('keeps the audit log append-only', () => {
    t.sql.run(
      `INSERT INTO audit_log (id, batch_id, entity, entity_id, action, at) VALUES (?,?,?,?,?,?)`,
      ['a-1', 'b-1', 'accounts', 'acc-cash', 'create', NOW],
    );
    expect(() => t.sql.run(`UPDATE audit_log SET action = 'delete'`)).toThrow(/append-only/);
  });

  it('rejects invalid JSON in JSON columns', () => {
    expect(() =>
      t.sql.run(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)`, [
        'x',
        '{oops',
        NOW,
      ]),
    ).toThrow();
  });
});

describe('integrityReport', () => {
  it('is clean on an empty database', () => {
    expect(integrityReport(createTestDb().sql).ok).toBe(true);
  });

  it('detects split sums that do not match (J3) and missing splits', () => {
    const t = createTestDb();
    seed(t);
    insertTx(t, { id: 'tx-1', amount: 12300 });
    insertTx(t, { id: 'tx-2', amount: 500 });
    const split = (id: string, tx: string, amount: number) =>
      t.sql.run(
        `INSERT INTO transaction_splits (id, created_at, updated_at, transaction_id, category_id, amount_minor) VALUES (?,?,?,?,?,?)`,
        [id, NOW, NOW, tx, 'cat-food', amount],
      );
    split('s-1', 'tx-1', 8000);
    split('s-2', 'tx-1', 4000); // 120.00 ≠ 123.00

    const r = integrityReport(t.sql);
    expect(r.splitSumMismatches).toBe(2); // tx-1 wrong sum, tx-2 sums to 0
    expect(r.nonTransferWithoutSplits).toBe(1);
    expect(r.ok).toBe(false);

    t.sql.run(`UPDATE transaction_splits SET amount_minor = 4300 WHERE id = 's-2'`);
    split('s-3', 'tx-2', 500);
    expect(integrityReport(t.sql).ok).toBe(true);
  });

  it('flags transfers that carry category splits', () => {
    const t = createTestDb();
    seed(t);
    insertTx(t, {
      id: 'tx-t',
      type: 'transfer',
      to: 'acc-bank',
      toAmount: 1000,
      toCurrency: 'USD',
    });
    t.sql.run(
      `INSERT INTO transaction_splits (id, created_at, updated_at, transaction_id, category_id, amount_minor) VALUES (?,?,?,?,?,?)`,
      ['s-t', NOW, NOW, 'tx-t', 'cat-food', 1000],
    );
    expect(integrityReport(t.sql).transfersWithSplits).toBe(1);
  });
});
