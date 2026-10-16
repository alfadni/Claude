import { invertRate, type CurrencyCode, type DecimalRate, type LocalDate } from '@/domain';

import type { DataDeps } from '../database';
import { fxRates } from '../schema';
import { withUnitOfWork } from '../unit-of-work';

export type FxRateRow = Readonly<{
  id: string;
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: DecimalRate;
  asOf: LocalDate;
  updatedAt: number;
}>;

/**
 * Manual FX rates (source 'manual' in v1). A row means 1 `base` = `rate` `quote`.
 * Rates the user typed (or a transfer implied) are recorded so the next entry
 * is prefilled; Settings → Exchange rates manages them (ADR-015).
 */
export function createFxRatesRepository(deps: DataDeps) {
  return {
    record(from: CurrencyCode, to: CurrencyCode, rate: DecimalRate, asOf: LocalDate): void {
      if (from === to) return;
      withUnitOfWork(deps, ({ now, newId, audit, tx }) => {
        const existing = deps.sql.all<{ id: string; rate: string; version: number }>(
          `SELECT id, rate, version FROM fx_rates WHERE base = ? AND quote = ? AND as_of = ? AND deleted_at IS NULL`,
          [from, to, asOf],
        )[0];
        if (existing) {
          if (existing.rate === rate) return;
          deps.sql.run(
            `UPDATE fx_rates SET rate = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
            [rate, now, existing.id],
          );
          audit({
            entity: 'fx_rates',
            entityId: existing.id,
            action: 'update',
            before: { rate: existing.rate },
            after: { rate },
          });
          return;
        }
        const row = {
          id: newId(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1,
          base: from,
          quote: to,
          rate,
          asOf,
          source: 'manual' as const,
        };
        tx.insert(fxRates).values(row).run();
        audit({ entity: 'fx_rates', entityId: row.id, action: 'create', after: row });
      });
    },

    /** Live rates, newest day first. */
    list(): FxRateRow[] {
      return deps.sql.all<FxRateRow>(
        `SELECT id, base, quote, rate, as_of AS asOf, updated_at AS updatedAt FROM fx_rates
         WHERE deleted_at IS NULL ORDER BY as_of DESC, base, quote`,
      );
    },

    /** Soft delete. Transactions keep their frozen rate, so history never changes. */
    remove(id: string): boolean {
      const row = deps.sql.all<{ id: string }>(
        'SELECT id FROM fx_rates WHERE id = ? AND deleted_at IS NULL',
        [id],
      )[0];
      if (!row) return false;
      withUnitOfWork(deps, ({ now, audit }) => {
        deps.sql.run('UPDATE fx_rates SET deleted_at = ?, updated_at = ? WHERE id = ?', [
          now,
          now,
          id,
        ]);
        audit({ entity: 'fx_rates', entityId: id, action: 'delete' });
      });
      return true;
    },

    /** Most recent known rate from → to on or before `asOf`, direct or inverted. */
    latest(from: CurrencyCode, to: CurrencyCode, asOf?: LocalDate): DecimalRate | null {
      if (from === to) return '1' as DecimalRate;
      const row = deps.sql.all<{ base: string; rate: string }>(
        `SELECT base, rate FROM fx_rates
         WHERE deleted_at IS NULL AND ((base = ? AND quote = ?) OR (base = ? AND quote = ?))
           AND (? IS NULL OR as_of <= ?)
         ORDER BY as_of DESC, updated_at DESC LIMIT 1`,
        [from, to, to, from, asOf ?? null, asOf ?? null],
      )[0];
      if (!row) return null;
      return row.base === from ? (row.rate as DecimalRate) : invertRate(row.rate as DecimalRate);
    },
  };
}

export type FxRatesRepository = ReturnType<typeof createFxRatesRepository>;
