import { eq } from 'drizzle-orm';

import { isDraftFresh } from '@/domain';

import type { DataDeps } from '../database';
import { drafts } from '../schema';

/**
 * Unsaved quick-add input. Kept inside the encrypted DB (it can hold amounts
 * and notes) rather than AsyncStorage. Drafts are scratch state, not ledger
 * entities, so they are deliberately not audited or synced.
 */
export function createDraftsRepository(deps: DataDeps) {
  const { db } = deps;
  return {
    save(key: string, payload: unknown): void {
      const json = JSON.stringify(payload);
      const savedAt = deps.now();
      db.insert(drafts)
        .values({ key, payload: json, savedAt })
        .onConflictDoUpdate({ target: drafts.key, set: { payload: json, savedAt } })
        .run();
    },

    /** Returns the draft if still fresh (10 min); stale drafts are discarded. */
    load(key: string): unknown {
      const row = db.select().from(drafts).where(eq(drafts.key, key)).get();
      if (!row) return null;
      if (!isDraftFresh(row.savedAt, deps.now())) {
        db.delete(drafts).where(eq(drafts.key, key)).run();
        return null;
      }
      try {
        return JSON.parse(row.payload);
      } catch {
        return null;
      }
    },

    clear(key: string): void {
      db.delete(drafts).where(eq(drafts.key, key)).run();
    },
  };
}

export type DraftsRepository = ReturnType<typeof createDraftsRepository>;
