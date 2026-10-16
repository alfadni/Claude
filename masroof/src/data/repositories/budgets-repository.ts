import { eq } from 'drizzle-orm';

import {
  convert,
  currentBudgetPeriod,
  err,
  evaluateBudget,
  isLocalDate,
  localDateOf,
  MAX_INPUT_MINOR,
  newlyReached,
  normalizeThresholds,
  ok,
  parseThresholds,
  previousBudgetPeriod,
  type BudgetEvaluation,
  type BudgetPeriodKind,
  type CurrencyCode,
  type LocalDate,
  type Period,
  type PeriodPhase,
  type Result,
} from '@/domain';

import type { DataDeps } from '../database';
import { budgets } from '../schema';
import { withUnitOfWork } from '../unit-of-work';
import type { CategoriesRepository } from './categories-repository';
import type { FxRatesRepository } from './fx-rates-repository';
import type { SettingsRepository } from './settings-repository';

export type BudgetRow = typeof budgets.$inferSelect;

export type BudgetInput = Readonly<{
  /** null = overall budget (all expenses). */
  categoryId: string | null;
  period: BudgetPeriodKind;
  customStart?: LocalDate | null;
  customEnd?: LocalDate | null;
  amountMinor: number;
  rollover: boolean;
  thresholds: readonly number[];
}>;

export type BudgetError =
  | 'amount_invalid'
  | 'thresholds_invalid'
  | 'category_missing'
  | 'category_archived'
  | 'category_not_expense'
  | 'custom_dates_invalid'
  | 'budget_exists'
  | 'not_found';

export type BudgetStatus = Readonly<{
  budget: BudgetRow;
  period: Period;
  phase: PeriodPhase;
  thresholds: number[];
  /** The category was archived after the budget was set (J6: prompt the user). */
  categoryArchived: boolean;
  /** Budget currency differs from base and no rate is known: no alerts fire. */
  missingRate: boolean;
  evaluation: BudgetEvaluation | null;
}>;

export type CrossedAlert = Readonly<{
  budgetId: string;
  categoryId: string | null;
  threshold: number;
}>;

/**
 * Budgets and their live evaluation (ADR-014). Nothing about spending is
 * stored: every status is computed from the ledger, so edits, deletes, undo
 * and imports are always reflected.
 */
export function createBudgetsRepository(
  deps: DataDeps & {
    today: () => LocalDate;
    timeZone: () => string;
    settings: SettingsRepository;
    categories: CategoriesRepository;
    fx: FxRatesRepository;
  },
) {
  const { db } = deps;
  const getRow = (id: string) => db.select().from(budgets).where(eq(budgets.id, id)).get();

  function validate(input: BudgetInput, existingId: string | null): BudgetError[] {
    const errors: BudgetError[] = [];
    if (
      !Number.isSafeInteger(input.amountMinor) ||
      input.amountMinor <= 0 ||
      input.amountMinor > MAX_INPUT_MINOR
    ) {
      errors.push('amount_invalid');
    }
    if (!normalizeThresholds(input.thresholds).ok) errors.push('thresholds_invalid');
    if (input.categoryId) {
      const c = deps.categories.get(input.categoryId);
      const before = existingId ? getRow(existingId) : undefined;
      if (!c || c.deletedAt !== null) errors.push('category_missing');
      else if (c.kind !== 'expense') errors.push('category_not_expense');
      else if (c.isArchived && before?.categoryId !== c.id) errors.push('category_archived');
    }
    if (input.period === 'custom') {
      const s = input.customStart ?? '';
      const e = input.customEnd ?? '';
      if (!isLocalDate(s) || !isLocalDate(e) || e < s) errors.push('custom_dates_invalid');
    } else {
      const clash = deps.sql.all(
        `SELECT 1 FROM budgets WHERE deleted_at IS NULL AND period = ?
           AND coalesce(category_id, '') = ? AND id <> ? LIMIT 1`,
        [input.period, input.categoryId ?? '', existingId ?? ''],
      );
      if (clash.length > 0) errors.push('budget_exists');
    }
    return errors;
  }

  function fields(input: BudgetInput) {
    const thresholds = normalizeThresholds(input.thresholds);
    return {
      categoryId: input.categoryId,
      period: input.period,
      customStart: input.period === 'custom' ? (input.customStart ?? null) : null,
      customEnd: input.period === 'custom' ? (input.customEnd ?? null) : null,
      amountMinor: input.amountMinor,
      rollover: input.period === 'custom' ? false : input.rollover,
      alertThresholds: JSON.stringify(thresholds.ok ? thresholds.value : []),
    };
  }

  /** The category and its sub-categories (budgets cover the whole branch). */
  function categoryBranch(categoryId: string): string[] {
    return [
      categoryId,
      ...deps.sql
        .all<{ id: string }>('SELECT id FROM categories WHERE parent_id = ?', [categoryId])
        .map((r) => r.id),
    ];
  }

  /** Posted expense spending (base minor) in [from, to) split at `today`. */
  function spending(
    categoryId: string | null,
    period: Period,
    today: LocalDate,
  ): { spent: number; scheduled: number } {
    const ids = categoryId ? categoryBranch(categoryId) : null;
    const catFilter = ids ? `AND s.category_id IN (${ids.map(() => '?').join(',')})` : '';
    const row = deps.sql.all<{ spent: number; scheduled: number }>(
      `SELECT
         coalesce(sum(CASE WHEN t.occurred_on <= ? THEN s.base_amount_minor END), 0) AS spent,
         coalesce(sum(CASE WHEN t.occurred_on > ? THEN s.base_amount_minor END), 0) AS scheduled
       FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id
       WHERE t.deleted_at IS NULL AND s.deleted_at IS NULL AND t.status = 'posted'
         AND t.type = 'expense' AND t.occurred_on >= ? AND t.occurred_on < ? ${catFilter}`,
      [today, today, period.start, period.end, ...(ids ?? [])],
    )[0];
    return { spent: row?.spent ?? 0, scheduled: row?.scheduled ?? 0 };
  }

  function status(b: BudgetRow, today: LocalDate): BudgetStatus {
    const firstDay = deps.settings.get('firstDayOfWeek');
    const base = deps.settings.get('baseCurrency');
    const { period, phase } = currentBudgetPeriod(b, today, firstDay);
    const thresholds = parseThresholds(b.alertThresholds);
    const category = b.categoryId ? deps.categories.get(b.categoryId) : undefined;
    const categoryArchived = !!category && category.isArchived;

    let amountBase = b.amountMinor;
    if (b.currency !== base) {
      const rate = deps.fx.latest(b.currency as CurrencyCode, base, today);
      if (!rate) {
        return {
          budget: b,
          period,
          phase,
          thresholds,
          categoryArchived,
          missingRate: true,
          evaluation: null,
        };
      }
      amountBase = convert(
        { amountMinor: b.amountMinor, currency: b.currency as CurrencyCode },
        rate,
        base,
      ).amountMinor;
    }

    let carryMinor = 0;
    const prev = b.rollover ? previousBudgetPeriod(period) : null;
    if (prev && localDateOf(b.createdAt, deps.timeZone()) < prev.end) {
      carryMinor = amountBase - spending(b.categoryId, prev, today).spent;
    }
    const { spent, scheduled } = spending(b.categoryId, period, today);
    const evaluation = evaluateBudget({
      amountMinor: amountBase,
      carryMinor,
      spentMinor: spent,
      scheduledMinor: scheduled,
      thresholds,
      period,
      today,
    });
    return {
      budget: b,
      period,
      phase,
      thresholds,
      categoryArchived,
      missingRate: false,
      evaluation,
    };
  }

  const api = {
    get: (id: string) => {
      const r = getRow(id);
      return r && r.deletedAt === null ? r : undefined;
    },

    list(): BudgetRow[] {
      return deps.sql
        .all<{ id: string }>(
          `SELECT b.id FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
           WHERE b.deleted_at IS NULL
           ORDER BY b.category_id IS NOT NULL, c.sort_order, b.period, b.created_at`,
        )
        .map((r) => getRow(r.id) as BudgetRow);
    },

    create(input: BudgetInput): Result<BudgetRow, BudgetError[]> {
      const errors = validate(input, null);
      if (errors.length > 0) return err(errors);
      return ok(
        withUnitOfWork(deps, ({ tx, now, newId, audit }) => {
          const row: BudgetRow = {
            id: newId(),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
            currency: deps.settings.get('baseCurrency'),
            ...fields(input),
          };
          tx.insert(budgets).values(row).run();
          audit({ entity: 'budgets', entityId: row.id, action: 'create', after: row });
          return row;
        }),
      );
    },

    update(id: string, input: BudgetInput): Result<BudgetRow, BudgetError[]> {
      const before = api.get(id);
      if (!before) return err(['not_found']);
      const errors = validate(input, id);
      if (errors.length > 0) return err(errors);
      return ok(
        withUnitOfWork(deps, ({ tx, now, audit }) => {
          const after: BudgetRow = {
            ...before,
            ...fields(input),
            updatedAt: now,
            version: before.version + 1,
          };
          tx.update(budgets).set(after).where(eq(budgets.id, id)).run();
          audit({ entity: 'budgets', entityId: id, action: 'update', before, after });
          return after;
        }),
      );
    },

    delete(id: string): boolean {
      const before = api.get(id);
      if (!before) return false;
      withUnitOfWork(deps, ({ tx, now, audit }) => {
        tx.update(budgets).set({ deletedAt: now, updatedAt: now }).where(eq(budgets.id, id)).run();
        audit({ entity: 'budgets', entityId: id, action: 'delete', before });
      });
      return true;
    },

    status: (b: BudgetRow, today = deps.today()) => status(b, today),

    statuses(today = deps.today()): BudgetStatus[] {
      return api.list().map((b) => status(b, today));
    },

    /**
     * Record every newly reached threshold of the current period and return
     * the ones to announce (highest per budget). Thresholds already recorded
     * never re-fire in the same period, even after spending drops and rises
     * again (J6). Budgets with an unknown rate or a period not active are skipped.
     */
    recordCrossings(today = deps.today()): CrossedAlert[] {
      const announce: CrossedAlert[] = [];
      withUnitOfWork(deps, ({ now }) => {
        for (const s of api.statuses(today)) {
          if (!s.evaluation || s.phase !== 'active') continue;
          const sentThisPeriod = new Set(
            deps.sql
              .all<{ t: number }>(
                'SELECT threshold AS t FROM budget_alerts_sent WHERE budget_id = ? AND period_start = ?',
                [s.budget.id, s.period.start],
              )
              .map((r) => r.t),
          );
          const { record, announce: top } = newlyReached(s.evaluation.reached, sentThisPeriod);
          for (const threshold of record) {
            deps.sql.run(
              `INSERT OR IGNORE INTO budget_alerts_sent (budget_id, period_start, threshold, sent_at)
               VALUES (?, ?, ?, ?)`,
              [s.budget.id, s.period.start, threshold, now],
            );
          }
          if (top !== null) {
            announce.push({
              budgetId: s.budget.id,
              categoryId: s.budget.categoryId,
              threshold: top,
            });
          }
        }
      });
      return announce;
    },

    /**
     * Category merge support: move budgets from one category to another.
     * Returns the source budgets that clash with a target budget of the same
     * period (the caller decides keep/combine).
     */
    conflictsOnMerge(
      sourceId: string,
      targetId: string,
    ): { source: BudgetRow; target: BudgetRow }[] {
      const live = api.list();
      const out: { source: BudgetRow; target: BudgetRow }[] = [];
      for (const s of live.filter((b) => b.categoryId === sourceId && b.period !== 'custom')) {
        const t = live.find((b) => b.categoryId === targetId && b.period === s.period);
        if (t) out.push({ source: s, target: t });
      }
      return out;
    },
  };
  return api;
}

export type BudgetsRepository = ReturnType<typeof createBudgetsRepository>;
