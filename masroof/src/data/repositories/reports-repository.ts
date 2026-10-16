import {
  convert,
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
