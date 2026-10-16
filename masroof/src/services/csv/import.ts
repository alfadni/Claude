import type { Repositories } from '@/data/repositories';
import { withUnitOfWork } from '@/data/unit-of-work';
import type { DataDeps } from '@/data/database';
import {
  err,
  isLocalDate,
  normalizeName,
  ok,
  parseAmount,
  startOfDayInZone,
  type CategoryKind,
  type CurrencyCode,
  type LocalDate,
  type Result,
  type TransactionInput,
  type TransactionType,
} from '@/domain';

import { parseCsv } from './csv';

/**
 * CSV import (J9): parse → preview with row-level errors → user maps unknown
 * categories → commit. Nothing is written until commit, and commit is
 * all-or-nothing.
 */
export type DateOrder = 'ymd' | 'dmy' | 'mdy';

export type ImportOptions = Readonly<{
  dateOrder: DateOrder;
  decimalSeparator: '.' | ',';
  /** Used when the file has no account column. */
  defaultAccountId: string;
  timeZone: string;
}>;

export type RowError =
  | 'date_invalid'
  | 'amount_invalid'
  | 'type_invalid'
  | 'account_unknown'
  | 'to_account_unknown'
  | 'currency_mismatch'
  | 'category_unmapped'
  | 'split_sum_mismatch';

export type PreviewRow = Readonly<{
  /** 1-based line numbers in the file (a split transaction spans several). */
  lines: number[];
  status: 'ok' | 'error' | 'duplicate';
  errors: RowError[];
  date: string;
  amount: string;
  type: TransactionType | null;
  categoryNames: string[];
  note: string;
}>;

export type ImportPreview = Readonly<{
  format: 'masroof' | 'generic';
  rows: PreviewRow[];
  /** Category names in the file that match no existing category (case-insensitive). */
  unknownCategories: { name: string; kind: CategoryKind }[];
  counts: { ok: number; error: number; duplicate: number };
}>;

/** Per unknown name: an existing category id, or 'create' to add it. */
export type CategoryMapping = Readonly<Record<string, string | 'create'>>;

export type ImportError = 'empty' | 'no_header' | 'missing_columns';

const SYNONYMS: Record<string, string[]> = {
  id: ['transaction_id'],
  date: ['date', 'transaction date', 'التاريخ', 'تاريخ'],
  type: ['type', 'النوع'],
  account: ['account', 'الحساب'],
  toAccount: ['to_account', 'to account'],
  amount: ['amount', 'value', 'المبلغ'],
  currency: ['currency', 'العملة'],
  toAmount: ['to_amount'],
  category: ['category', 'الفئة'],
  splitAmount: ['category_amount'],
  note: ['note', 'notes', 'description', 'memo', 'ملاحظة'],
  payee: ['payee', 'merchant', 'الجهة'],
  tags: ['tags', 'الوسوم'],
};

type Field = keyof typeof SYNONYMS;

function mapHeader(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    for (const [field, names] of Object.entries(SYNONYMS)) {
      if (names.includes(key) && out[field as Field] === undefined) out[field as Field] = i;
    }
  });
  return out;
}

/** Undo our own formula-injection guard on round trips ("'=x" → "=x"). */
const unguard = (v: string) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

export function parseDate(raw: string, order: DateOrder): LocalDate | null {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return toDate(+iso[1]!, +iso[2]!, +iso[3]!);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (!m) return null;
  const a = +m[1]!;
  const b = +m[2]!;
  let y = +m[3]!;
  if (y < 100) y += 2000;
  if (order === 'ymd') return null; // a non-ISO date with ymd order is ambiguous
  return order === 'dmy' ? toDate(y, b, a) : toDate(y, a, b);
}

function toDate(y: number, mo: number, d: number): LocalDate | null {
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  const s = `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`;
  return isLocalDate(s) ? (s as LocalDate) : null;
}

type Group = { lines: number[]; cells: string[][] };

export function createCsvImporter(deps: DataDeps & { repos: Repositories }) {
  const { repos } = deps;

  function resolve(text: string, options: ImportOptions) {
    const table = parseCsv(text);
    if (table.length === 0) return err<ImportError>('empty');
    const header = table[0] as string[];
    const cols = mapHeader(header);
    if (cols.date === undefined || cols.amount === undefined) {
      return err<ImportError>(
        cols.date === undefined && cols.amount === undefined ? 'no_header' : 'missing_columns',
      );
    }
    const format: 'masroof' | 'generic' =
      cols.id !== undefined && cols.splitAmount !== undefined ? 'masroof' : 'generic';
    const cell = (r: string[], f: Field) =>
      cols[f] === undefined ? '' : unguard((r[cols[f] as number] ?? '').trim());

    // Group rows: our own export has one row per split, keyed by transaction_id.
    const groups: Group[] = [];
    const byId = new Map<string, Group>();
    table.slice(1).forEach((r, i) => {
      const line = i + 2;
      const id = format === 'masroof' ? cell(r, 'id') : '';
      const existing = id ? byId.get(id) : undefined;
      if (existing) {
        existing.lines.push(line);
        existing.cells.push(r);
      } else {
        const g = { lines: [line], cells: [r] };
        groups.push(g);
        if (id) byId.set(id, g);
      }
    });

    const accounts = repos.accounts.list({ includeArchived: true });
    const accountByName = new Map(accounts.map((a) => [normalizeName(a.name), a]));
    const categories = repos.categories.list(undefined, { includeArchived: true });
    const catKey = (kind: CategoryKind, name: string) => `${kind}:${normalizeName(name)}`;
    const categoryByName = new Map(categories.map((c) => [catKey(c.kind, c.name), c]));

    return ok({ format, groups, cell, accountByName, categoryByName, catKey, options });
  }

  function build(
    r: Exclude<ReturnType<typeof resolve>, { ok: false }>['value'],
    mapping: CategoryMapping,
    createdIds: ReadonlyMap<string, string> = new Map(),
  ) {
    const { format, groups, cell, accountByName, categoryByName, catKey, options } = r;
    const seen = new Set<string>();
    const unknown = new Map<string, { name: string; kind: CategoryKind }>();
    const out: { row: PreviewRow; input: TransactionInput | null }[] = [];

    for (const g of groups) {
      const first = g.cells[0] as string[];
      const errors: RowError[] = [];
      const rawDate = cell(first, 'date');
      const date = parseDate(rawDate, options.dateOrder);
      if (!date) errors.push('date_invalid');

      const accountName = cell(first, 'account');
      const account = accountName
        ? accountByName.get(normalizeName(accountName))
        : repos.accounts.get(options.defaultAccountId);
      if (!account) errors.push('account_unknown');
      const currency = (account?.currency ?? 'USD') as CurrencyCode;
      const fileCurrency = cell(first, 'currency').toUpperCase();
      if (account && fileCurrency && fileCurrency !== account.currency)
        errors.push('currency_mismatch');

      const rawAmount = cell(first, 'amount');
      const parsed = parseAmount(rawAmount, currency, {
        decimalSeparator: options.decimalSeparator,
        allowNegative: true,
      });
      const signed = parsed.ok ? parsed.value.amountMinor : null;
      if (signed === null || signed === 0) errors.push('amount_invalid');

      const rawType = cell(first, 'type').toLowerCase();
      // With no type column, the sign decides; if the amount is unreadable the
      // type is unknowable, so only the amount error is reported.
      const explicit =
        rawType === 'expense' || rawType === 'income' || rawType === 'transfer' ? rawType : null;
      if (rawType !== '' && !explicit) errors.push('type_invalid');
      const type: TransactionType | null =
        explicit ??
        (rawType === '' && signed !== null ? (signed < 0 ? 'expense' : 'income') : null);
      const amountMinor = signed === null ? 0 : Math.abs(signed);

      let toAccountId: string | null = null;
      let toAmountMinor: number | null = null;
      const categoryNames: string[] = [];
      const splits: { categoryId: string; amountMinor: number }[] = [];

      if (type === 'transfer') {
        const to = accountByName.get(normalizeName(cell(first, 'toAccount')));
        if (!to) errors.push('to_account_unknown');
        toAccountId = to?.id ?? null;
        const ta = cell(first, 'toAmount');
        if (to && ta) {
          const p = parseAmount(ta, to.currency as CurrencyCode, {
            decimalSeparator: options.decimalSeparator,
          });
          toAmountMinor = p.ok ? p.value.amountMinor : null;
        }
      } else if (type) {
        const kind: CategoryKind = type;
        for (const c of g.cells) {
          const name = cell(c, 'category');
          const splitRaw = format === 'masroof' ? cell(c, 'splitAmount') : '';
          const splitParsed = splitRaw
            ? parseAmount(splitRaw, currency, { decimalSeparator: options.decimalSeparator })
            : null;
          const splitMinor = splitParsed
            ? splitParsed.ok
              ? splitParsed.value.amountMinor
              : -1
            : amountMinor;
          categoryNames.push(name);
          const existing = name ? categoryByName.get(catKey(kind, name)) : undefined;
          const mapped = mapping[name];
          const categoryId =
            existing?.id ??
            (mapped === 'create' ? createdIds.get(catKey(kind, name)) : mapped) ??
            null;
          if (!existing && name) unknown.set(catKey(kind, name), { name, kind });
          // 'create' mappings are resolved at commit time (second pass); a failed create
          // leaves the placeholder id, which makes the whole commit roll back.
          if (!categoryId && mapped !== 'create') errors.push('category_unmapped');
          splits.push({ categoryId: categoryId ?? '__pending__', amountMinor: splitMinor });
        }
        if (splits.reduce((a, s) => a + s.amountMinor, 0) !== amountMinor)
          errors.push('split_sum_mismatch');
      }

      const note = cell(first, 'note');
      const uniqueErrors = [...new Set(errors)];
      let status: PreviewRow['status'] = uniqueErrors.length ? 'error' : 'ok';
      let input: TransactionInput | null = null;
      if (status === 'ok' && date && account && type) {
        const key = `${account.id}|${date}|${type}|${amountMinor}|${normalizeName(note)}`;
        const existingDup =
          deps.sql.all(
            `SELECT 1 FROM transactions WHERE deleted_at IS NULL AND status = 'posted' AND account_id = ? AND occurred_on = ? AND type = ? AND amount_minor = ?
               AND lower(trim(coalesce(note, ''))) = ? LIMIT 1`,
            [account.id, date, type, amountMinor, normalizeName(note)],
          ).length > 0;
        if (existingDup || seen.has(key)) status = 'duplicate';
        seen.add(key);
        input = {
          type,
          accountId: account.id,
          toAccountId,
          amountMinor,
          toAmountMinor,
          occurredAt: startOfDayInZone(date, options.timeZone) + 12 * 3_600_000,
          occurredTz: options.timeZone,
          occurredOn: date,
          note: note || null,
          payeeName: cell(first, 'payee') || null,
          tagNames: cell(first, 'tags')
            .split(/[;,]/)
            .map((x) => x.trim())
            .filter(Boolean),
          splits,
        };
      }
      out.push({
        row: {
          lines: g.lines,
          status,
          errors: uniqueErrors,
          date: date ?? rawDate,
          amount: rawAmount,
          type,
          categoryNames,
          note,
        },
        input,
      });
    }
    return { out, unknown: [...unknown.values()] };
  }

  function preview(
    text: string,
    options: ImportOptions,
    mapping: CategoryMapping = {},
  ): Result<ImportPreview, ImportError> {
    const r = resolve(text, options);
    if (!r.ok) return r;
    const { out, unknown } = build(r.value, mapping);
    const rows = out.map((o) => o.row);
    return ok({
      format: r.value.format,
      rows,
      unknownCategories: unknown,
      counts: {
        ok: rows.filter((x) => x.status === 'ok').length,
        error: rows.filter((x) => x.status === 'error').length,
        duplicate: rows.filter((x) => x.status === 'duplicate').length,
      },
    });
  }

  /**
   * Import every 'ok' row (errors and duplicates are skipped) in one unit of
   * work. Any failure rolls everything back, including created categories.
   */
  function commit(
    text: string,
    options: ImportOptions,
    mapping: CategoryMapping,
  ): Result<
    { imported: number; skipped: number },
    ImportError | { line: number; errors: string[] }
  > {
    const r = resolve(text, options);
    if (!r.ok) return r;
    try {
      return withUnitOfWork(deps, () => {
        const created = new Map<string, string>();
        const { unknown } = build(r.value, mapping);
        for (const u of unknown) {
          if (mapping[u.name] !== 'create') continue;
          const c = repos.categories.create({ name: u.name, kind: u.kind });
          if (c.ok) created.set(r.value.catKey(u.kind, u.name), c.value.id);
        }
        const { out } = build(r.value, mapping, created);
        let imported = 0;
        for (const o of out) {
          if (o.row.status !== 'ok' || !o.input) continue;
          const res = repos.transactions.create(o.input);
          if (!res.ok) throw new CommitFailure(o.row.lines[0] ?? 0, res.error);
          imported++;
        }
        return ok({ imported, skipped: out.length - imported });
      });
    } catch (e) {
      if (e instanceof CommitFailure) return err({ line: e.line, errors: e.errors });
      throw e;
    }
  }

  return { preview, commit };
}

class CommitFailure extends Error {
  constructor(
    readonly line: number,
    readonly errors: string[],
  ) {
    super('import failed');
  }
}

export type CsvImporter = ReturnType<typeof createCsvImporter>;
