import { csvField, neutralizeFormula, parseCsv, toCsv } from '@/services/csv/csv';
import { exportTransactionsCsv } from '@/services/csv/export';
import { createCsvImporter, parseDate, type ImportOptions } from '@/services/csv/import';

import { createLedger, must, TZ } from '../../helpers/ledger';

const name = (c: { name: string }) => c.name;

describe('CSV parsing (RFC 4180)', () => {
  it('handles quotes, embedded commas/quotes/newlines, CRLF and BOM', () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\n2,"multi\nline",\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', 'multi\nline', ''],
    ]);
  });

  it('round-trips with toCsv', () => {
    const rows = [['a,b', 'q"q', 'line\nbreak', '']];
    expect(parseCsv(toCsv(['h1', 'h2', 'h3', 'h4'], rows))).toEqual([
      ['h1', 'h2', 'h3', 'h4'],
      ...rows,
    ]);
    expect(csvField('plain')).toBe('plain');
  });

  it('neutralises spreadsheet formulas', () => {
    for (const v of ['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)', '\tx'])
      expect(neutralizeFormula(v)).toBe(`'${v}`);
    expect(neutralizeFormula('lunch')).toBe('lunch');
  });

  it('parses dates in ISO and the chosen order', () => {
    expect(parseDate('2026-10-16', 'dmy')).toBe('2026-10-16');
    expect(parseDate('16/10/2026', 'dmy')).toBe('2026-10-16');
    expect(parseDate('10/16/2026', 'mdy')).toBe('2026-10-16');
    expect(parseDate('16.10.26', 'dmy')).toBe('2026-10-16');
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseDate('16/10/2026', 'ymd')).toBeNull();
    expect(parseDate('yesterday', 'dmy')).toBeNull();
  });
});

function setup() {
  const l = createLedger();
  const importer = createCsvImporter({ ...l, repos: l.repos });
  const options: ImportOptions = {
    dateOrder: 'dmy',
    decimalSeparator: '.',
    defaultAccountId: l.ids.cash,
    timeZone: TZ,
  };
  return { l, importer, options };
}

describe('CSV export', () => {
  it('one row per split, transfers included, formulas neutralised', () => {
    const { l } = setup();
    must(
      l.repos.transactions.create(
        l.expense({
          amountMinor: 12300,
          note: '=cmd|calc',
          tagNames: ['eid', 'family'],
          splits: [
            { categoryId: l.ids.clothes, amountMinor: 8000 },
            { categoryId: l.ids.kids, amountMinor: 4300 },
          ],
        }),
      ),
    );
    must(l.repos.transactions.create(l.transfer()));
    const rows = parseCsv(exportTransactionsCsv(l.sql, name));
    expect(rows[0]).toEqual([
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
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[1]?.slice(2, 12)).toEqual([
      'expense',
      'Cash',
      '',
      '123.00',
      'USD',
      '',
      '',
      'Clothes',
      '80.00',
      "'=cmd|calc",
    ]);
    expect(rows[2]?.[10]).toBe('43.00');
    expect(rows[1]?.[13]).toBe('eid;family');
    expect(rows[3]?.slice(2, 9)).toEqual([
      'transfer',
      'Bank',
      'Cash',
      '100.00',
      'USD',
      '100.00',
      'USD',
    ]);
  });

  it('excludes deleted transactions', () => {
    const { l } = setup();
    const { id } = must(l.repos.transactions.create(l.expense()));
    must(l.repos.transactions.delete(id));
    expect(parseCsv(exportTransactionsCsv(l.sql, name))).toHaveLength(1);
  });
});

describe('J9 CSV import', () => {
  const csv = (lines: string[]) => lines.join('\n');

  it('generic bank CSV: preview first, nothing written until commit', () => {
    const { l, importer, options } = setup();
    const text = csv([
      'Date,Description,Amount,Category',
      '15/10/2026,Coffee,-4.50,Food',
      '14/10/2026,Salary,3000,Salary',
    ]);
    const p = must(importer.preview(text, options));
    expect(p.counts).toEqual({ ok: 2, error: 0, duplicate: 0 });
    expect(p.rows.map((r) => r.type)).toEqual(['expense', 'income']);
    expect(l.repos.transactions.list({}, null)).toEqual([]);
    expect(must(importer.commit(text, options, {}))).toEqual({ imported: 2, skipped: 0 });
    expect(l.repos.transactions.list({}, null).map((t) => [t.type, t.amountMinor, t.note])).toEqual(
      [
        ['expense', 450, 'Coffee'],
        ['income', 300000, 'Salary'],
      ],
    );
  });

  it('row-level errors: bad dates, bad amounts, unknown accounts, unknown categories', () => {
    const { importer, options } = setup();
    const text = csv([
      'date,amount,account,category,note',
      '31/02/2026,-5,Cash,Food,bad date',
      '15/10/2026,abc,Cash,Food,bad amount',
      '15/10/2026,-5,Nowhere,Food,unknown account',
      '15/10/2026,-5,Cash,Gym,unknown category',
      '15/10/2026,-5,Cash,Food,fine',
    ]);
    const p = must(importer.preview(text, options));
    expect(p.rows.map((r) => [r.lines[0], r.status, r.errors])).toEqual([
      [2, 'error', ['date_invalid']],
      [3, 'error', ['amount_invalid']],
      [4, 'error', ['account_unknown']],
      [5, 'error', ['category_unmapped']],
      [6, 'ok', []],
    ]);
    expect(p.unknownCategories).toEqual([{ name: 'Gym', kind: 'expense' }]);
  });

  it('user maps unknown categories: to an existing one, or creates it', () => {
    const { l, importer, options } = setup();
    const text = csv(['date,amount,category', '15/10/2026,-5,Gym', '15/10/2026,-7,Snacks']);
    const mapping = { Gym: 'create', Snacks: l.ids.food } as const;
    expect(must(importer.preview(text, options, mapping)).counts.ok).toBe(2);
    must(importer.commit(text, options, mapping));
    const gym = l.repos.categories.list('expense').find((c) => c.name === 'Gym');
    expect(gym).toBeDefined();
    expect(
      l.repos.reports
        .categoryTotals(
          { kind: 'custom', start: '2026-10-15' as never, end: '2026-10-16' as never },
          'expense',
        )
        .map((c) => c.categoryId)
        .sort(),
    ).toEqual([gym?.id, l.ids.food].sort());
  });

  it('duplicates (already in the ledger or repeated in the file) are flagged and skipped', () => {
    const { l, importer, options } = setup();
    must(
      l.repos.transactions.create(
        l.expense({
          note: 'Coffee',
          amountMinor: 450,
          splits: [{ categoryId: l.ids.food, amountMinor: 450 }],
        }),
      ),
    );
    const today = l.repos.today().split('-').reverse().join('/');
    const text = csv([
      'date,note,amount,category',
      `${today},Coffee,-4.50,Food`,
      `${today},Tea,-2,Food`,
      `${today},Tea,-2,Food`,
    ]);
    const p = must(importer.preview(text, options));
    expect(p.rows.map((r) => r.status)).toEqual(['duplicate', 'ok', 'duplicate']);
    expect(must(importer.commit(text, options, {}))).toEqual({ imported: 1, skipped: 2 });
  });

  it('own export re-imports exactly (splits and transfers), and a second import is all duplicates', () => {
    const { l } = setup();
    must(
      l.repos.transactions.create(
        l.expense({
          amountMinor: 12300,
          note: '=x',
          splits: [
            { categoryId: l.ids.clothes, amountMinor: 8000 },
            { categoryId: l.ids.kids, amountMinor: 4300 },
          ],
        }),
      ),
    );
    must(l.repos.transactions.create(l.transfer()));
    const text = exportTransactionsCsv(l.sql, name);

    const fresh = createLedger();
    const imp = createCsvImporter({ ...fresh, repos: fresh.repos });
    const opts: ImportOptions = {
      dateOrder: 'ymd',
      decimalSeparator: '.',
      defaultAccountId: fresh.ids.cash,
      timeZone: TZ,
    };
    const p = must(imp.preview(text, opts));
    expect(p.format).toBe('masroof');
    expect(p.counts).toEqual({ ok: 2, error: 0, duplicate: 0 });
    must(imp.commit(text, opts, {}));
    const list = fresh.repos.transactions.list({}, null);
    expect(list.map((t) => [t.type, t.amountMinor, t.splitCount])).toEqual([
      ['transfer', 10000, 0],
      ['expense', 12300, 2],
    ]);
    expect(list[1]?.note).toBe('=x'); // the formula guard is undone on import
    expect(must(imp.preview(text, opts)).counts).toEqual({ ok: 0, error: 0, duplicate: 2 });
  });

  it('split rows that do not add up are errors', () => {
    const { importer, options } = setup();
    const text = csv([
      'transaction_id,date,type,account,amount,currency,category,category_amount',
      'a,2026-10-15,expense,Cash,123.00,USD,Clothes,80.00',
      'a,2026-10-15,expense,Cash,123.00,USD,Kids,40.00',
    ]);
    expect(must(importer.preview(text, { ...options, dateOrder: 'ymd' })).rows[0]?.errors).toEqual([
      'split_sum_mismatch',
    ]);
  });

  it('currency in the file must match the account', () => {
    const { importer, options } = setup();
    const p = must(
      importer.preview(csv(['date,amount,currency,category', '15/10/2026,-5,EUR,Food']), options),
    );
    expect(p.rows[0]?.errors).toEqual(['currency_mismatch']);
  });

  it('missing required columns / empty files are rejected up front', () => {
    const { importer, options } = setup();
    expect(importer.preview('', options)).toEqual({ ok: false, error: 'empty' });
    expect(importer.preview('foo,bar\n1,2', options)).toEqual({ ok: false, error: 'no_header' });
    expect(importer.preview('date,foo\n1,2', options)).toEqual({
      ok: false,
      error: 'missing_columns',
    });
  });

  it('commit is all-or-nothing', () => {
    const { l, importer, options } = setup();
    // An archived account passes preview (it exists) but the ledger refuses it at commit.
    const acc = must(
      l.repos.accounts.create({
        name: 'Old',
        type: 'cash',
        currency: 'USD',
        openingBalanceMinor: 0,
        openedOn: null,
        includeInTotals: true,
      }),
    );
    l.repos.accounts.setArchived(acc.id, true);
    const text = csv([
      'date,amount,account,category',
      '15/10/2026,-5,Cash,Food',
      '15/10/2026,-6,Old,Food',
    ]);
    const r = importer.commit(text, options, {});
    expect(r).toEqual({ ok: false, error: { line: 3, errors: ['account_archived'] } });
    expect(l.repos.transactions.list({}, null)).toEqual([]);
  });

  it('accepts Arabic headers', () => {
    const { importer, options } = setup();
    const p = must(importer.preview(csv(['التاريخ,المبلغ,الفئة', '15/10/2026,-5,Food']), options));
    expect(p.counts.ok).toBe(1);
  });
});
