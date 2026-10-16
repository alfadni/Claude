import {
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
  /** New base per transaction id (for the preview totals). */
  baseById: Map<string, number>;
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
  const transactions = () =>
    deps.sql.all<TxRow>(
      `SELECT id, type, status, deleted_at AS deletedAt, amount_minor AS amountMinor, currency,
              to_amount_minor AS toAmountMinor, to_currency AS toCurrency, occurred_on AS occurredOn
       FROM transactions`,
    );
  const liveBudgets = () =>
    deps.sql.all<BudgetRow>(
      'SELECT id, amount_minor AS amountMinor, currency FROM budgets WHERE deleted_at IS NULL',
    );

  /** A transfer arriving in the new base uses its received leg; no rate needed. */
  const needsRate = (t: TxRow, to: CurrencyCode) =>
    t.currency !== to && !(t.type === 'transfer' && t.toCurrency === to && t.toAmountMinor);

  function required(to: CurrencyCode): RequiredRate[] {
    const counts = new Map<CurrencyCode, { transactions: number; budgets: number }>();
    const bump = (c: CurrencyCode, key: 'transactions' | 'budgets') => {
      const v = counts.get(c) ?? { transactions: 0, budgets: 0 };
      v[key]++;
      counts.set(c, v);
    };
    for (const t of transactions()) if (needsRate(t, to)) bump(t.currency, 'transactions');
    for (const b of liveBudgets()) if (b.currency !== to) bump(b.currency, 'budgets');
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, c]) => ({
        currency,
        suggested: deps.fx.latest(currency, to, deps.today()),
        ...c,
      }));
  }

  function plan(to: CurrencyCode, rates: RateMap): Result<Plan, BaseChangeError> {
    const from = deps.settings.get('baseCurrency');
    if (from === to) return err({ code: 'same_currency' });
    const missing = required(to)
      .map((r) => r.currency)
      .filter((c) => !rates.get(c));
    if (missing.length > 0) return err({ code: 'rates_missing', currencies: missing });

    const splitsByTx = new Map<string, SplitRow[]>();
    for (const s of deps.sql.all<SplitRow>(
      `SELECT id, transaction_id AS transactionId, amount_minor AS amountMinor, deleted_at AS deletedAt
       FROM transaction_splits ORDER BY transaction_id, sort_order, id`,
    )) {
      const list = splitsByTx.get(s.transactionId) ?? [];
      list.push(s);
      splitsByTx.set(s.transactionId, list);
    }

    const out: Plan = { tx: [], splits: [], budgets: [], baseById: new Map() };
    for (const t of transactions()) {
      const leg = t.type === 'transfer' && t.toCurrency === to ? t.toAmountMinor : null;
      // Splits are re-allocated per generation (live, or replaced by an earlier
      // edit), so each set still sums exactly to the parent's base amount.
      const groups = new Map<number | null, SplitRow[]>();
      for (const s of splitsByTx.get(t.id) ?? []) {
        groups.set(s.deletedAt, [...(groups.get(s.deletedAt) ?? []), s]);
      }
      const { fxRateToBase: rate, baseAmountMinor: baseMinor } = computeBaseAmounts({
        amount: money(t.amountMinor, t.currency),
        baseCurrency: to,
        rate: needsRate(t, to) ? (rates.get(t.currency) as DecimalRate) : null,
        baseLegMinor: leg,
        splitAmounts: [],
      });
      for (const g of groups.values()) {
        const { splitBaseMinor } = computeBaseAmounts({
          amount: money(t.amountMinor, t.currency),
          baseCurrency: to,
          rate: needsRate(t, to) ? (rates.get(t.currency) as DecimalRate) : null,
          baseLegMinor: leg,
          splitAmounts: g.map((s) => s.amountMinor),
        });
        g.forEach((s, i) => out.splits.push({ id: s.id, baseMinor: splitBaseMinor[i] ?? 0 }));
      }
      out.tx.push({ id: t.id, rate, baseMinor });
      out.baseById.set(t.id, baseMinor);
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
    return ok(out);
  }

  return {
    requiredRates: (to: CurrencyCode) => required(to),

    /** What the change would do, without writing anything (J10 "preview"). */
    preview(to: CurrencyCode, rates: RateMap): Result<BaseChangePreview, BaseChangeError> {
      const p = plan(to, rates);
      if (!p.ok) return p;
      const today = deps.today();
      const month = monthOf(today);
      const before = deps.reports.periodTotals(month, today);
      const after = { incomeMinor: 0, expenseMinor: 0, spentSoFarMinor: 0 };
      for (const t of transactions()) {
        if (t.deletedAt !== null || t.status !== 'posted' || t.type === 'transfer') continue;
        if (t.occurredOn < month.start || t.occurredOn >= month.end) continue;
        const base = p.value.baseById.get(t.id) ?? 0;
        if (t.type === 'income') after.incomeMinor += base;
        else {
          after.expenseMinor += base;
          if (t.occurredOn <= today) after.spentSoFarMinor += base;
        }
      }
      return ok({
        from: deps.settings.get('baseCurrency'),
        to,
        transactions: p.value.tx.length,
        budgets: p.value.budgets.length,
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
      const p = plan(to, rates);
      if (!p.ok) return p;
      const from = deps.settings.get('baseCurrency');
      return withUnitOfWork(deps, ({ now, audit }) => {
        for (const t of p.value.tx) {
          deps.sql.run(
            `UPDATE transactions SET fx_rate_to_base = ?, base_amount_minor = ?, updated_at = ?,
               version = version + 1 WHERE id = ?`,
            [t.rate, t.baseMinor, now, t.id],
          );
        }
        for (const s of p.value.splits) {
          deps.sql.run('UPDATE transaction_splits SET base_amount_minor = ? WHERE id = ?', [
            s.baseMinor,
            s.id,
          ]);
        }
        for (const b of p.value.budgets) {
          deps.sql.run(
            `UPDATE budgets SET amount_minor = ?, currency = ?, updated_at = ?, version = version + 1
             WHERE id = ?`,
            [b.amountMinor, to, now, b.id],
          );
        }
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
