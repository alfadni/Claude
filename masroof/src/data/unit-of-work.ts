import type { Id } from '@/domain';

import type { AppDatabase, DataDeps } from './database';
import { auditLog } from './schema';

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'purge';

export type AuditEntry = Readonly<{
  entity: string;
  entityId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
}>;

export type UnitOfWork = Readonly<{
  tx: AppDatabase;
  /** Groups every audit row of this operation, so undo can reverse it as one. */
  batchId: Id;
  now: number;
  newId: () => Id;
  audit: (entry: AuditEntry) => void;
}>;

const ACTIVE = new WeakMap<AppDatabase, UnitOfWork>();

/**
 * The only way to mutate data: runs `fn` in a DB transaction and gives it an
 * audit writer. If `fn` throws, data and audit rows roll back together.
 *
 * Re-entrant: a repository call made inside another unit of work joins it
 * (same transaction, same batch id), so services can compose repository
 * writes atomically (e.g. onboarding creates an account and advances its step
 * in one commit).
 */
export function withUnitOfWork<T>(deps: DataDeps, fn: (uow: UnitOfWork) => T): T {
  const active = ACTIVE.get(deps.db);
  if (active) return fn(active);
  return deps.db.transaction((tx) => {
    const batchId = deps.newId();
    const now = deps.now();
    const audit = (e: AuditEntry) => {
      tx.insert(auditLog)
        .values({
          id: deps.newId(),
          batchId,
          entity: e.entity,
          entityId: e.entityId,
          action: e.action,
          beforeJson: e.before === undefined ? null : JSON.stringify(e.before),
          afterJson: e.after === undefined ? null : JSON.stringify(e.after),
          at: now,
        })
        .run();
    };
    // drizzle's sync transaction type is a subclass of the db type.
    const uow: UnitOfWork = {
      tx: tx as unknown as AppDatabase,
      batchId,
      now,
      newId: deps.newId,
      audit,
    };
    ACTIVE.set(deps.db, uow);
    try {
      return fn(uow);
    } finally {
      ACTIVE.delete(deps.db);
    }
  });
}
