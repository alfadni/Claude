import type { SqlExecutor } from '@/data/sql-executor';
import { money, toDecimalString, type CurrencyCode } from '@/domain';

import { neutralizeFormula, toCsv } from './csv';

export const EXPORT_COLUMNS = [
  'transaction_id',
  'date',
  'type',
  'account',
  'to_account',
  'amount',
  'currency',
  'to_amount',
  'to_currency',
  'category',
  'category_amount',
  'note',
  'payee',
  'tags',
] as const;

type Row = {
  id: string;
  date: string;
  type: string;
  account: string;
  toAccount: string | null;
  amount: number;
  currency: string;
  toAmount: number | null;
  toCurrency: string | null;
  category: string | null;
  splitAmount: number | null;
  note: string | null;
  payee: string | null;
  tags: string | null;
};

/**
 * Plain-text CSV of all live transactions: one row per split (so splits
 * re-import exactly), one row per transfer. The UI must warn that the file
 * is NOT encrypted (spec 7).
 */
export function exportTransactionsCsv(
  sql: SqlExecutor,
  categoryName: (c: { name: string; seedKey: string | null }) => string,
): string {
  const rows = sql.all<Row & { seedKey: string | null }>(
    `SELECT t.id, t.occurred_on AS date, t.type, a.name AS account, ta.name AS toAccount,
            t.amount_minor AS amount, t.currency, t.to_amount_minor AS toAmount, t.to_currency AS toCurrency,
            c.name AS category, c.seed_key AS seedKey, s.amount_minor AS splitAmount, t.note, p.name AS payee,
            (SELECT group_concat(g.name, ';') FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.transaction_id = t.id) AS tags
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts ta ON ta.id = t.to_account_id
     LEFT JOIN transaction_splits s ON s.transaction_id = t.id AND s.deleted_at IS NULL
     LEFT JOIN categories c ON c.id = s.category_id
     LEFT JOIN payees p ON p.id = t.payee_id
     WHERE t.deleted_at IS NULL AND t.status = 'posted'
     ORDER BY t.occurred_at, t.id, s.sort_order`,
  );
  const dec = (minor: number | null, currency: string | null) =>
    minor === null || currency === null
      ? ''
      : toDecimalString(money(minor, currency as CurrencyCode));
  const text = (v: string | null) => neutralizeFormula(v ?? '');
  return toCsv(
    EXPORT_COLUMNS,
    rows.map((r) => [
      r.id,
      r.date,
      r.type,
      text(r.account),
      text(r.toAccount),
      dec(r.amount, r.currency),
      r.currency,
      dec(r.toAmount, r.toCurrency),
      r.toCurrency ?? '',
      r.category ? text(categoryName({ name: r.category, seedKey: r.seedKey })) : '',
      dec(r.splitAmount, r.currency),
      text(r.note),
      text(r.payee),
      text(r.tags),
    ]),
  );
}
