import { and, eq, isNull } from 'drizzle-orm';

import { cleanTagNames, normalizeName, likePattern } from '@/domain';

import type { DataDeps } from '../database';
import { payees, tags } from '../schema';
import { withUnitOfWork } from '../unit-of-work';

/** Payees and tags: free text the user types, deduplicated case-insensitively. */
export function createNamesRepository(deps: DataDeps) {
  const { db } = deps;

  return {
    /** Find-or-create a payee. Blank names mean "no payee". */
    upsertPayee(name: string | null | undefined): string | null {
      const clean = (name ?? '').trim().replace(/\s+/g, ' ');
      if (!clean) return null;
      const key = normalizeName(clean);
      const existing = db
        .select()
        .from(payees)
        .where(and(eq(payees.normalizedName, key), isNull(payees.deletedAt)))
        .get();
      if (existing) return existing.id;
      return withUnitOfWork(deps, ({ tx, now, newId, audit }) => {
        const row = {
          id: newId(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1,
          name: clean.slice(0, 80),
          normalizedName: key,
        };
        tx.insert(payees).values(row).run();
        audit({ entity: 'payees', entityId: row.id, action: 'create', after: row });
        return row.id;
      });
    },

    upsertTags(names: readonly string[]): string[] {
      return cleanTagNames(names).map((name) => {
        const key = normalizeName(name);
        const existing = db
          .select()
          .from(tags)
          .where(and(eq(tags.normalizedName, key), isNull(tags.deletedAt)))
          .get();
        if (existing) return existing.id;
        return withUnitOfWork(deps, ({ tx, now, newId, audit }) => {
          const row = {
            id: newId(),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
            name: name.slice(0, 40),
            normalizedName: key,
            color: null,
          };
          tx.insert(tags).values(row).run();
          audit({ entity: 'tags', entityId: row.id, action: 'create', after: row });
          return row.id;
        });
      });
    },

    searchPayees(prefix: string, limit = 5): { id: string; name: string }[] {
      const key = normalizeName(prefix);
      if (!key) return [];
      return deps.sql.all(
        `SELECT p.id, p.name FROM payees p WHERE p.deleted_at IS NULL AND p.normalized_name LIKE ? ESCAPE '\\'
         ORDER BY (SELECT max(t.occurred_at) FROM transactions t WHERE t.payee_id = p.id) DESC LIMIT ?`,
        [likePattern(key).slice(1), limit],
      );
    },

    listTags(): { id: string; name: string }[] {
      return deps.sql.all(
        'SELECT id, name FROM tags WHERE deleted_at IS NULL ORDER BY normalized_name',
      );
    },
  };
}

export type NamesRepository = ReturnType<typeof createNamesRepository>;
