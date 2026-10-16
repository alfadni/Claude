import { invertRate, type CurrencyCode, type DecimalRate, type LocalDate } from '@/domain';

import type { DataDeps } from '../database';
import { fxRates } from '../schema';
import { withUnitOfWork } from '../unit-of-work';

/**
 * Manual FX rates (source 'manual' in v1). A row means 1 `base` = `rate` `quote`.
 * Phase 1 records the rate the user typed (or a transfer implied) so the next
 * entry in that currency is prefilled; the full FX table UI is Phase 4.
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
