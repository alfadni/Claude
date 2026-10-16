import { and, eq, isNull } from 'drizzle-orm';

import { err, ok, parseTemplate, replaceCategory, type Result } from '@/domain';

import type { DataDeps } from '../database';
import { budgets, categories, recurringRules } from '../schema';
import { withUnitOfWork } from '../unit-of-work';
import type { BudgetRow, BudgetsRepository } from './budgets-repository';
import type { CategoriesRepository } from './categories-repository';

export type MergeError =
  | 'not_found'
  | 'same_category'
  | 'kind_mismatch'
  | 'target_archived'
  | 'source_has_children'
  | 'budget_conflict'
  | 'budget_currency_mismatch';

/** How to resolve a source budget that clashes with a target budget (J6). */
export type BudgetResolution = 'keep_target' | 'combine';

export type MergeResult = Readonly<{
  movedSplits: number;
  movedBudgets: number;
  rulesUpdated: number;
}>;

/**
 * Merge one category into another (spec 5.14, J6). Everything moves in one
 * unit of work; the source is archived, never hard-deleted.
 */
export function createCategoryMerge(
  deps: DataDeps & { categories: CategoriesRepository; budgets: BudgetsRepository },
) {
  return {
    /** Budgets that would clash, so the UI can ask before merging. */
    conflicts(sourceId: string, targetId: string): { source: BudgetRow; target: BudgetRow }[] {
      return deps.budgets.conflictsOnMerge(sourceId, targetId);
    },

    merge(
      sourceId: string,
      targetId: string,
      resolution?: BudgetResolution,
    ): Result<MergeResult, MergeError> {
      const source = deps.categories.get(sourceId);
      const target = deps.categories.get(targetId);
      if (!source || !target || source.deletedAt !== null || target.deletedAt !== null) {
        return err('not_found');
      }
      if (sourceId === targetId) return err('same_category');
      if (source.kind !== target.kind) return err('kind_mismatch');
      if (target.isArchived) return err('target_archived');
      const children = deps.sql.all<{ id: string }>(
        'SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL',
        [sourceId],
      );
      // One level of sub-categories (spec 4): children can only move under a top-level target.
      if (
        children.length > 0 &&
        (target.parentId !== null || children.some((c) => c.id === targetId))
      ) {
        return err('source_has_children');
      }
      const clashes = deps.budgets.conflictsOnMerge(sourceId, targetId);
      if (clashes.length > 0 && !resolution) return err('budget_conflict');
      if (
        resolution === 'combine' &&
        clashes.some((c) => c.source.currency !== c.target.currency)
      ) {
        return err('budget_currency_mismatch');
      }

      return ok(
        withUnitOfWork(deps, ({ tx, now, audit }) => {
          const movedSplits =
            deps.sql.all<{ n: number }>(
              'SELECT count(*) AS n FROM transaction_splits WHERE category_id = ?',
              [sourceId],
            )[0]?.n ?? 0;
          deps.sql.run(
            'UPDATE transaction_splits SET category_id = ?, updated_at = ? WHERE category_id = ?',
            [targetId, now, sourceId],
          );
          deps.sql.run('UPDATE categories SET parent_id = ?, updated_at = ? WHERE parent_id = ?', [
            targetId,
            now,
            sourceId,
          ]);

          let rulesUpdated = 0;
          const rules = tx
            .select()
            .from(recurringRules)
            .where(isNull(recurringRules.deletedAt))
            .all();
          for (const rule of rules) {
            const t = parseTemplate(rule.templateJson);
            if (!t.ok || !t.value.splits.some((s) => s.categoryId === sourceId)) continue;
            const after = {
              ...rule,
              templateJson: JSON.stringify(replaceCategory(t.value, sourceId, targetId)),
              lastError: null,
              updatedAt: now,
              version: rule.version + 1,
            };
            tx.update(recurringRules).set(after).where(eq(recurringRules.id, rule.id)).run();
            audit({
              entity: 'recurring_rules',
              entityId: rule.id,
              action: 'update',
              before: rule,
              after,
            });
            rulesUpdated++;
          }

          let movedBudgets = 0;
          const clashBySource = new Map(clashes.map((c) => [c.source.id, c.target]));
          const sourceBudgets = tx
            .select()
            .from(budgets)
            .where(and(eq(budgets.categoryId, sourceId), isNull(budgets.deletedAt)))
            .all();
          for (const b of sourceBudgets) {
            const clash = clashBySource.get(b.id);
            if (clash) {
              if (resolution === 'combine') {
                const after = {
                  ...clash,
                  amountMinor: clash.amountMinor + b.amountMinor,
                  updatedAt: now,
                  version: clash.version + 1,
                };
                tx.update(budgets).set(after).where(eq(budgets.id, clash.id)).run();
                audit({
                  entity: 'budgets',
                  entityId: clash.id,
                  action: 'update',
                  before: clash,
                  after,
                });
              }
              tx.update(budgets)
                .set({ deletedAt: now, updatedAt: now })
                .where(eq(budgets.id, b.id))
                .run();
              audit({ entity: 'budgets', entityId: b.id, action: 'delete', before: b });
            } else {
              const after = { ...b, categoryId: targetId, updatedAt: now, version: b.version + 1 };
              tx.update(budgets).set(after).where(eq(budgets.id, b.id)).run();
              audit({ entity: 'budgets', entityId: b.id, action: 'update', before: b, after });
              movedBudgets++;
            }
          }

          const archived = {
            ...source,
            isArchived: true,
            updatedAt: now,
            version: source.version + 1,
          };
          tx.update(categories).set(archived).where(eq(categories.id, sourceId)).run();
          audit({
            entity: 'categories',
            entityId: sourceId,
            action: 'update',
            before: source,
            after: { ...archived, mergedInto: targetId, movedSplits },
          });
          return { movedSplits, movedBudgets, rulesUpdated };
        }),
      );
    },
  };
}

export type CategoryMerge = ReturnType<typeof createCategoryMerge>;
