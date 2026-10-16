import {
  addMonths,
  convert,
  monthOf,
  previous,
  type CategoryKind,
  type CurrencyCode,
  type LocalDate,
  type Period,
} from '@/domain';

import type { DataDeps } from '../database';
import type { AccountsRepository } from './accounts-repository';
import type { FxRatesRepository } from './fx-rates-repository';
import type { SettingsRepository } from './settings-repository';

export type DaySummary = Readonly<{ date: LocalDate; incomeMinor: number; expenseMinor: number }>;

export type PeriodTotals = Readonly<{
  incomeMinor: number;
  /** All expenses dated in the period, including scheduled (future) ones. */
  expenseMinor: number;
  /** Expenses dated on or before today: "spent so far" (J2: scheduled excluded). */
  spentSoFarMinor: number;
  scheduledExpenseMinor: number;
}>;

export type CategoryTotal = Readonly<{ categoryId: string; totalMinor: number; share: number }>;

export type MonthTotals = Readonly<{ month: LocalDate; incomeMinor: number; expenseMinor: number }>;

export type CategoryDelta = Readonly<{
  categoryId: string;
  currentMinor: number;
  previousMinor: number;
  /** current - previous (positive = spent more). */
  deltaMinor: number;
}>;

export type PayeeTotal = Readonly<{ name: string; totalMinor: number; count: number }>;

export type NetWorth = Readonly<{
  currency: CurrencyCode;
  totalMinor: number;
  /** Accounts left out because no FX rate to the base currency is known yet. */
  missingRateAccountIds: string[];
}>;

/**
 * Read models for Home and reports. Every amount is in the base currency
 * using base amounts frozen at entry time (spec 4). Transfers never count as
 * income or expense (J4). Deleted and non-posted rows are excluded.
 */
export function createReportsRepository(
  deps: DataDeps & {
    settings: SettingsRepository;
    accounts: AccountsRepository;
    fx: FxRatesRepository;
  },
) {
  const live = `t.deleted_at IS NULL AND t.status = 'posted' AND t.type <> 'transfer'`;

  return {
    daySummaries(period: Period): DaySummary[] {
      return deps.sql.all<DaySummary>(
        `SELECT t.occurred_on AS date,
                sum(CASE WHEN t.type = 'income' THEN t.base_amount_minor ELSE 0 END) AS incomeMinor,
                sum(CASE WHEN t.type = 'expense' THEN t.base_amount_minor ELSE 0 END) AS expenseMinor
         FROM transactions t
         WHERE ${live} AND t.occurred_on >= ? AND t.occurred_on < ?
         GROUP BY t.occurred_on ORDER BY t.occurred_on`,
        [period.start, period.end],
      );
    },

    periodTotals(period: Period, today: LocalDate): PeriodTotals {
      const row = deps.sql.all<PeriodTotals>(
        `SELECT
           coalesce(sum(CASE WHEN t.type = 'income' THEN t.base_amount_minor END), 0) AS incomeMinor,
           coalesce(sum(CASE WHEN t.type = 'expense' THEN t.base_amount_minor END), 0) AS expenseMinor,
           coalesce(sum(CASE WHEN t.type = 'expense' AND t.occurred_on <= ? THEN t.base_amount_minor END), 0) AS spentSoFarMinor,
           coalesce(sum(CASE WHEN t.type = 'expense' AND t.occurred_on > ? THEN t.base_amount_minor END), 0) AS scheduledExpenseMinor
         FROM transactions t
         WHERE ${live} AND t.occurred_on >= ? AND t.occurred_on < ?`,
        [today, today, period.start, period.end],
      )[0];
      return (
        row ?? { incomeMinor: 0, expenseMinor: 0, spentSoFarMinor: 0, scheduledExpenseMinor: 0 }
      );
    },

    /** Per-category totals from split base amounts, so splits report exactly (J3). */
    categoryTotals(period: Period, kind: CategoryKind): CategoryTotal[] {
      const rows = deps.sql.all<{ categoryId: string; totalMinor: number }>(
        `SELECT s.category_id AS categoryId, sum(s.base_amount_minor) AS totalMinor
         FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id
         WHERE ${live} AND s.deleted_at IS NULL AND t.type = ?
           AND t.occurred_on >= ? AND t.occurred_on < ?
         GROUP BY s.category_id ORDER BY totalMinor DESC, s.category_id`,
        [kind, period.start, period.end],
      );
      const total = rows.reduce((a, r) => a + r.totalMinor, 0);
      return rows.map((r) => ({ ...r, share: total === 0 ? 0 : r.totalMinor / total }));
    },

    /**
     * Income and expense per calendar month, oldest first, for the `count`
     * months ending with `lastMonth` (ADR-016 trend). Amounts dated after
     * `today` are scheduled, not yet income/spent, so they are left out.
     */
    monthlyTotals(lastMonth: Period, count: number, today: LocalDate): MonthTotals[] {
      const first = addMonths(lastMonth.start, -(count - 1));
      const rows = deps.sql.all<{ m: string; incomeMinor: number; expenseMinor: number }>(
        `SELECT substr(t.occurred_on, 1, 7) AS m,
                coalesce(sum(CASE WHEN t.type = 'income' THEN t.base_amount_minor END), 0) AS incomeMinor,
                coalesce(sum(CASE WHEN t.type = 'expense' THEN t.base_amount_minor END), 0) AS expenseMinor
         FROM transactions t
         WHERE ${live} AND t.occurred_on >= ? AND t.occurred_on < ? AND t.occurred_on <= ?
         GROUP BY m`,
        [first, lastMonth.end, today],
      );
      const byMonth = new Map(rows.map((r) => [r.m, r]));
      const out: MonthTotals[] = [];
      for (let i = 0; i < count; i++) {
        const month = monthOf(addMonths(first, i)).start;
        const r = byMonth.get(month.slice(0, 7));
        out.push({ month, incomeMinor: r?.incomeMinor ?? 0, expenseMinor: r?.expenseMinor ?? 0 });
      }
      return out;
    },

    /** Per-category totals in a period vs the period before (month-over-month). */
    categoryComparison(period: Period, kind: CategoryKind, today: LocalDate): CategoryDelta[] {
      const prev = previous(period);
      const rows = deps.sql.all<{
        categoryId: string;
        currentMinor: number;
        previousMinor: number;
      }>(
        `SELECT s.category_id AS categoryId,
                coalesce(sum(CASE WHEN t.occurred_on >= ? THEN s.base_amount_minor END), 0) AS currentMinor,
                coalesce(sum(CASE WHEN t.occurred_on < ? THEN s.base_amount_minor END), 0) AS previousMinor
         FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id
         WHERE ${live} AND s.deleted_at IS NULL AND t.type = ?
           AND t.occurred_on >= ? AND t.occurred_on < ? AND t.occurred_on <= ?
         GROUP BY s.category_id`,
        [period.start, period.start, kind, prev.start, period.end, today],
      );
      return rows
        .map((r) => ({ ...r, deltaMinor: r.currentMinor - r.previousMinor }))
        .sort(
          (a, b) =>
            Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor) ||
            b.currentMinor - a.currentMinor ||
            a.categoryId.localeCompare(b.categoryId),
        );
    },

    /** Where the money went: expense totals by payee. */
    topPayees(period: Period, limit: number, today: LocalDate): PayeeTotal[] {
      return deps.sql.all<PayeeTotal>(
        `SELECT p.name AS name, sum(t.base_amount_minor) AS totalMinor, count(*) AS count
         FROM transactions t JOIN payees p ON p.id = t.payee_id
         WHERE ${live} AND t.type = 'expense'
           AND t.occurred_on >= ? AND t.occurred_on < ? AND t.occurred_on <= ?
         GROUP BY p.id ORDER BY totalMinor DESC, count DESC, p.name LIMIT ?`,
        [period.start, period.end, today, limit],
      );
    },

    /** Balance across accounts marked "include in totals", in the base currency. */
    netWorth(asOf: LocalDate): NetWorth {
      const baseCurrency = deps.settings.get('baseCurrency');
      const balances = deps.accounts.balances(asOf);
      let totalMinor = 0;
      const missingRateAccountIds: string[] = [];
      for (const a of deps.accounts.list()) {
        if (!a.includeInTotals) continue;
        const bal = balances.get(a.id) ?? a.openingBalanceMinor;
        const currency = a.currency as CurrencyCode;
        if (currency === baseCurrency) {
          totalMinor += bal;
          continue;
        }
        const rate = deps.fx.latest(currency, baseCurrency, asOf);
        if (!rate) {
          missingRateAccountIds.push(a.id);
          continue;
        }
        totalMinor += convert({ amountMinor: bal, currency }, rate, baseCurrency).amountMinor;
      }
      return { currency: baseCurrency, totalMinor, missingRateAccountIds };
    },

    /** True if anything at all has been recorded (drives the Home empty state). */
    hasAnyTransactions(): boolean {
      return (
        deps.sql.all(
          `SELECT 1 FROM transactions WHERE deleted_at IS NULL AND status = 'posted' LIMIT 1`,
        ).length > 0
      );
    },
  };
}

export type ReportsRepository = ReturnType<typeof createReportsRepository>;
