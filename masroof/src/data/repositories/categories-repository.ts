import { and, asc, eq, isNull } from 'drizzle-orm';

import {
  err,
  MAX_CATEGORY_NAME,
  ok,
  SEED_CATEGORIES,
  validateName,
  type CategoryFacts,
  type CategoryKind,
  type NameError,
  type Result,
} from '@/domain';

import type { DataDeps } from '../database';
import { categories } from '../schema';
import { withUnitOfWork } from '../unit-of-work';

export type CategoryRow = typeof categories.$inferSelect;

export function createCategoriesRepository(deps: DataDeps) {
  const { db } = deps;
  const get = (id: string) => db.select().from(categories).where(eq(categories.id, id)).get();

  return {
    get,

    /** Idempotent: inserts only seed categories that are missing. */
    seedDefaults(): number {
      return withUnitOfWork(deps, ({ tx, now, newId, audit }) => {
        const existing = new Set(
          deps.sql
            .all<{ k: string }>('SELECT seed_key AS k FROM categories WHERE seed_key IS NOT NULL')
            .map((r) => r.k),
        );
        let inserted = 0;
        SEED_CATEGORIES.forEach((seed, index) => {
          if (existing.has(seed.seedKey)) return;
          const row: CategoryRow = {
            id: newId(),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
            name: seed.name,
            kind: seed.kind,
            parentId: null,
            icon: seed.icon,
            color: seed.color,
            isSystem: true,
            isArchived: false,
            sortOrder: index,
            seedKey: seed.seedKey,
          };
          tx.insert(categories).values(row).run();
          audit({ entity: 'categories', entityId: row.id, action: 'create', after: row });
          inserted++;
        });
        return inserted;
      });
    },

    list(kind?: CategoryKind, options: { includeArchived?: boolean } = {}): CategoryRow[] {
      const conds = [isNull(categories.deletedAt)];
      if (kind) conds.push(eq(categories.kind, kind));
      if (!options.includeArchived) conds.push(eq(categories.isArchived, false));
      return db
        .select()
        .from(categories)
        .where(and(...conds))
        .orderBy(asc(categories.sortOrder), asc(categories.createdAt))
        .all();
    },

    /** Most recently used first, for the quick-add grid (spec 5.3). */
    recentIds(kind: CategoryKind, limit = 8): string[] {
      return deps.sql
        .all<{ id: string }>(
          `SELECT s.category_id AS id FROM transaction_splits s
           JOIN transactions t ON t.id = s.transaction_id
           JOIN categories c ON c.id = s.category_id
           WHERE s.deleted_at IS NULL AND t.deleted_at IS NULL AND c.kind = ?
             AND c.is_archived = 0 AND c.deleted_at IS NULL
           GROUP BY s.category_id ORDER BY max(t.created_at) DESC LIMIT ?`,
          [kind, limit],
        )
        .map((r) => r.id);
    },

    facts(id: string): CategoryFacts | undefined {
      const c = get(id);
      return c
        ? { id: c.id, kind: c.kind, isArchived: c.isArchived, isDeleted: c.deletedAt !== null }
        : undefined;
    },

    create(input: {
      name: string;
      kind: CategoryKind;
      icon?: string | null;
      color?: string | null;
    }): Result<CategoryRow, NameError> {
      const e = validateName(input.name, MAX_CATEGORY_NAME);
      if (e) return err(e);
      return ok(
        withUnitOfWork(deps, ({ tx, now, newId, audit }) => {
          const max = deps.sql.all<{ m: number | null }>(
            'SELECT max(sort_order) AS m FROM categories WHERE kind = ?',
            [input.kind],
          )[0]?.m;
          const row: CategoryRow = {
            id: newId(),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
            name: input.name.trim(),
            kind: input.kind,
            parentId: null,
            icon: input.icon ?? '🏷️',
            color: input.color ?? '#4B5563',
            isSystem: false,
            isArchived: false,
            sortOrder: (max ?? -1) + 1,
            seedKey: null,
          };
          tx.insert(categories).values(row).run();
          audit({ entity: 'categories', entityId: row.id, action: 'create', after: row });
          return row;
        }),
      );
    },

    rename(id: string, name: string): Result<CategoryRow, NameError | 'not_found'> {
      const before = get(id);
      if (!before || before.deletedAt !== null) return err('not_found');
      const e = validateName(name, MAX_CATEGORY_NAME);
      if (e) return err(e);
      return ok(
        withUnitOfWork(deps, ({ tx, now, audit }) => {
          const after = {
            ...before,
            name: name.trim(),
            updatedAt: now,
            version: before.version + 1,
          };
          tx.update(categories).set(after).where(eq(categories.id, id)).run();
          audit({ entity: 'categories', entityId: id, action: 'update', before, after });
          return after;
        }),
      );
    },

    /** Categories are archived, never hard-deleted (spec 5.14). */
    setArchived(id: string, archived: boolean): boolean {
      const before = get(id);
      if (!before || before.deletedAt !== null || before.isArchived === archived) return false;
      withUnitOfWork(deps, ({ tx, now, audit }) => {
        const after = {
          ...before,
          isArchived: archived,
          updatedAt: now,
          version: before.version + 1,
        };
        tx.update(categories).set(after).where(eq(categories.id, id)).run();
        audit({ entity: 'categories', entityId: id, action: 'update', before, after });
      });
      return true;
    },

    /** Persist a new order for one kind; ids not of that kind are ignored. */
    reorder(kind: CategoryKind, orderedIds: readonly string[]): void {
      withUnitOfWork(deps, ({ tx, now, audit }) => {
        orderedIds.forEach((id, index) => {
          const before = get(id);
          if (!before || before.kind !== kind || before.sortOrder === index) return;
          const after = {
            ...before,
            sortOrder: index,
            updatedAt: now,
            version: before.version + 1,
          };
          tx.update(categories).set(after).where(eq(categories.id, id)).run();
          audit({ entity: 'categories', entityId: id, action: 'update', before, after });
        });
      });
    },
  };
}

export type CategoriesRepository = ReturnType<typeof createCategoriesRepository>;
