import {
  allocate,
  computeBaseAmounts,
  parseTemplate,
  convert,
  err,
  monthOf,
  money,
  ok,
  type CurrencyCode,
  type DecimalRate,
  type LocalDate,
  type Result,
} from '@/domain';

import type { DataDeps } from '../database';
import { withUnitOfWork } from '../unit-of-work';
import type { FxRatesRepository } from './fx-rates-repository';
import type { ReportsRepository } from './reports-repository';
import type { SettingsRepository } from './settings-repository';

/** Rate from a currency to the new base: 1 `currency` = rate `newBase`. */
export type RateMap = ReadonlyMap<CurrencyCode, DecimalRate>;

export type RequiredRate = Readonly<{
  currency: CurrencyCode;
  /** Prefill from the FX table (direct or inverted), if known. */
  suggested: DecimalRate | null;
  transactions: number;
  budgets: number;
}>;

export type BaseChangePreview = Readonly<{
  from: CurrencyCode;
  to: CurrencyCode;
  transactions: number;
  budgets: number;
  month: { start: LocalDate };
  before: { incomeMinor: number; expenseMinor: number; spentSoFarMinor: number };
  after: { incomeMinor: number; expenseMinor: number; spentSoFarMinor: number };
}>;

export type BaseChangeError =
  { code: 'same_currency' } | { code: 'rates_missing'; currencies: CurrencyCode[] };

type TxRow = {
  id: string;
  type: 'expense' | 'income' | 'transfer';
  status: string;
  deletedAt: number | null;
  amountMinor: number;
  currency: CurrencyCode;
  toAmountMinor: number | null;
  toCurrency: CurrencyCode | null;
  occurredOn: string;
};
type SplitRow = {
  id: string;
  transactionId: string;
  amountMinor: number;
  deletedAt: number | null;
};
type BudgetRow = { id: string; amountMinor: number; currency: CurrencyCode };

type Plan = {
  tx: { id: string; rate: DecimalRate; baseMinor: number }[];
  splits: { id: string; baseMinor: number }[];
  budgets: { id: string; amountMinor: number }[];
};

/**
 * Change the base currency (J10, ADR-015): preview first, then recompute
 * every frozen base amount in one unit of work. Original amounts and
 * currencies are never touched.
 */
export function createBaseCurrencyRepository(
  deps: DataDeps & {
    today: () => LocalDate;
    settings: SettingsRepository;
    fx: FxRatesRepository;
    reports: ReportsRepository;
  },
) {
  /** Rows to recompute: everything, or one date range (the preview). */
  const transactions = (range?: { from: LocalDate; to: LocalDate }) =>
    deps.sql.all<TxRow>(
      `SELECT id, type, status, deleted_at AS deletedAt, amount_minor AS amountMinor, currency,
              to_amount_minor AS toAmountMinor, to_currency AS toCurrency, occurred_on AS occurredOn
       FROM transactions ${range ? 'WHERE occurred_on >= ? AND occurred_on < ?' : ''}`,
      range ? [range.from, range.to] : [],
    );
  const liveBudgets = () =>
    deps.sql.all<BudgetRow>(
      'SELECT id, amount_minor AS amountMinor, currency FROM budgets WHERE deleted_at IS NULL',
    );

  /** A transfer arriving in the new base uses its received leg; no rate needed. */
  const needsRate = (t: TxRow, to: CurrencyCode) =>
    t.currency !== to && !(t.type === 'transfer' && t.toCurrency === to && t.toAmountMinor);

  /** Grouped in SQL: one pass over the table, no rows copied into JS. */
  function required(to: CurrencyCode): RequiredRate[] {
    const counts = new Map<CurrencyCode, { transactions: number; budgets: number }>();
    for (const r of deps.sql.all<{ currency: CurrencyCode; n: number }>(
      `SELECT currency, count(*) AS n FROM transactions
       WHERE currency <> ? AND NOT (type = 'transfer' AND to_currency = ? AND to_amount_minor IS NOT NULL)
       GROUP BY currency`,
      [to, to],
    )) {
      counts.set(r.currency, { transactions: r.n, budgets: 0 });
    }
    for (const r of deps.sql.all<{ currency: CurrencyCode; n: number }>(
      'SELECT currency, count(*) AS n FROM budgets WHERE deleted_at IS NULL AND currency <> ? GROUP BY currency',
      [to],
    )) {
      counts.set(r.currency, {
        transactions: counts.get(r.currency)?.transactions ?? 0,
        budgets: r.n,
      });
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, c]) => ({
        currency,
        suggested: deps.fx.latest(currency, to, deps.today()),
        ...c,
      }));
  }

  function check(to: CurrencyCode, rates: RateMap): BaseChangeError | null {
    if (deps.settings.get('baseCurrency') === to) return { code: 'same_currency' };
    const missing = required(to)
      .map((r) => r.currency)
      .filter((c) => !rates.get(c));
    return missing.length > 0 ? { code: 'rates_missing', currencies: missing } : null;
  }

  /** New base amount and rate of one transaction, exactly as entry would compute it. */
  function rebase(t: TxRow, to: CurrencyCode, rates: RateMap) {
    return computeBaseAmounts({
      amount: money(t.amountMinor, t.currency),
      baseCurrency: to,
      rate: needsRate(t, to) ? (rates.get(t.currency) as DecimalRate) : null,
      baseLegMinor: t.type === 'transfer' && t.toCurrency === to ? t.toAmountMinor : null,
      splitAmounts: [],
    });
  }

  function plan(to: CurrencyCode, rates: RateMap): Plan {
    const splitsByTx = new Map<string, SplitRow[]>();
    for (const s of deps.sql.all<SplitRow>(
      `SELECT id, transaction_id AS transactionId, amount_minor AS amountMinor, deleted_at AS deletedAt
       FROM transaction_splits ORDER BY transaction_id, sort_order, id`,
    )) {
      const list = splitsByTx.get(s.transactionId);
      if (list) list.push(s);
      else splitsByTx.set(s.transactionId, [s]);
    }

    const out: Plan = { tx: [], splits: [], budgets: [] };
    for (const t of transactions()) {
      const { fxRateToBase, baseAmountMinor } = rebase(t, to, rates);
      out.tx.push({ id: t.id, rate: fxRateToBase, baseMinor: baseAmountMinor });
      // Splits are re-allocated per generation (live, or replaced by an earlier
      // edit), so each set still sums exactly to the parent's base amount.
      const groups = new Map<number | null, SplitRow[]>();
      for (const s of splitsByTx.get(t.id) ?? []) {
        const g = groups.get(s.deletedAt);
        if (g) g.push(s);
        else groups.set(s.deletedAt, [s]);
      }
      for (const g of groups.values()) {
        const shares = allocate(
          money(baseAmountMinor, to),
          g.map((s) => s.amountMinor),
        );
        g.forEach((s, i) => out.splits.push({ id: s.id, baseMinor: shares[i]?.amountMinor ?? 0 }));
      }
    }
    for (const b of liveBudgets()) {
      if (b.currency === to) continue;
      out.budgets.push({
        id: b.id,
        amountMinor: convert(
          { amountMinor: b.amountMinor, currency: b.currency },
          rates.get(b.currency) as DecimalRate,
          to,
        ).amountMinor,
      });
    }
    return out;
  }

  return {
    requiredRates: (to: CurrencyCode) => required(to),

    /** What the change would do, without writing anything (J10 "preview"). */
    preview(to: CurrencyCode, rates: RateMap): Result<BaseChangePreview, BaseChangeError> {
      const problem = check(to, rates);
      if (problem) return err(problem);
      const today = deps.today();
      const month = monthOf(today);
      const before = deps.reports.periodTotals(month, today);
      const after = { incomeMinor: 0, expenseMinor: 0, spentSoFarMinor: 0 };
      // Only this month's rows are recomputed for the preview; apply uses the
      // same rebase() for every row, so the numbers match exactly.
      for (const t of transactions({ from: month.start, to: month.end })) {
        if (t.deletedAt !== null || t.status !== 'posted' || t.type === 'transfer') continue;
        const base = rebase(t, to, rates).baseAmountMinor;
        if (t.type === 'income') after.incomeMinor += base;
        else {
          after.expenseMinor += base;
          if (t.occurredOn <= today) after.spentSoFarMinor += base;
        }
      }
      const counts = deps.sql.all<{ n: number }>('SELECT count(*) AS n FROM transactions')[0];
      return ok({
        from: deps.settings.get('baseCurrency'),
        to,
        transactions: counts?.n ?? 0,
        budgets: liveBudgets().filter((b) => b.currency !== to).length,
        month: { start: month.start },
        before: {
          incomeMinor: before.incomeMinor,
          expenseMinor: before.expenseMinor,
          spentSoFarMinor: before.spentSoFarMinor,
        },
        after,
      });
    },

    /** Recompute everything in one unit of work: all or nothing. */
    apply(to: CurrencyCode, rates: RateMap): Result<{ transactions: number }, BaseChangeError> {
      const problem = check(to, rates);
      if (problem) return err(problem);
      const from = deps.settings.get('baseCurrency');
      const p = { value: plan(to, rates) };
      return withUnitOfWork(deps, ({ now, audit }) => {
        deps.sql.runMany(
          `UPDATE transactions SET fx_rate_to_base = ?, base_amount_minor = ?, updated_at = ?,
             version = version + 1 WHERE id = ?`,
          p.value.tx.map((t) => [t.rate, t.baseMinor, now, t.id]),
        );
        deps.sql.runMany(
          'UPDATE transaction_splits SET base_amount_minor = ? WHERE id = ?',
          p.value.splits.map((x) => [x.baseMinor, x.id]),
        );
        deps.sql.runMany(
          `UPDATE budgets SET amount_minor = ?, currency = ?, updated_at = ?, version = version + 1
           WHERE id = ?`,
          p.value.budgets.map((b) => [b.amountMinor, to, now, b.id]),
        );
        // Rule templates keep a fallback rate to the *old* base; drop it so a
        // later occurrence uses the FX table or stops with "rate required".
        let rulesUpdated = 0;
        for (const rule of deps.sql.all<{ id: string; templateJson: string }>(
          'SELECT id, template_json AS templateJson FROM recurring_rules WHERE deleted_at IS NULL',
        )) {
          const tpl = parseTemplate(rule.templateJson);
          if (!tpl.ok || tpl.value.fxRateToBase === null) continue;
          deps.sql.run(
            `UPDATE recurring_rules SET template_json = ?, updated_at = ?, version = version + 1
             WHERE id = ?`,
            [JSON.stringify({ ...tpl.value, fxRateToBase: null }), now, rule.id],
          );
          rulesUpdated++;
        }
        for (const [currency, rate] of rates) {
          if (currency !== to) deps.fx.record(currency, to, rate, deps.today());
        }
        deps.settings.set('baseCurrency', to);
        audit({
          entity: 'settings',
          entityId: 'baseCurrency',
          action: 'update',
          before: { baseCurrency: from },
          after: {
            baseCurrency: to,
            rates: Object.fromEntries(rates),
            transactions: p.value.tx.length,
            budgets: p.value.budgets.length,
            rulesUpdated,
          },
        });
        return ok({ transactions: p.value.tx.length });
      });
    },
  };
}

export type BaseCurrencyRepository = ReturnType<typeof createBaseCurrencyRepository>;
