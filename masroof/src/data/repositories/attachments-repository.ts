import { and, eq, isNull } from 'drizzle-orm';

import { MAX_ATTACHMENTS } from '@/domain';

import type { DataDeps } from '../database';
import { attachments, transactions } from '../schema';
import { withUnitOfWork } from '../unit-of-work';

export type NewAttachment = Readonly<{
  id: string;
  transactionId: string;
  filePath: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}>;

export function createAttachmentsRepository(deps: DataDeps) {
  const { db } = deps;
  const liveCount = (transactionId: string) =>
    deps.sql.all<{ n: number }>(
      'SELECT count(*) AS n FROM attachments WHERE transaction_id = ? AND deleted_at IS NULL',
      [transactionId],
    )[0]?.n ?? 0;

  return {
    liveCount,

    /** Fails (returns false) if the transaction is gone or already has 5 files. */
    insert(a: NewAttachment): 'ok' | 'not_found' | 'limit_reached' {
      const tx = db.select().from(transactions).where(eq(transactions.id, a.transactionId)).get();
      if (!tx || tx.deletedAt !== null) return 'not_found';
      if (liveCount(a.transactionId) >= MAX_ATTACHMENTS) return 'limit_reached';
      withUnitOfWork(deps, ({ tx: t, now, audit }) => {
        const row = { ...a, createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
        t.insert(attachments).values(row).run();
        audit({ entity: 'attachments', entityId: a.id, action: 'create', after: row });
      });
      return 'ok';
    },

    remove(id: string): boolean {
      const before = db.select().from(attachments).where(eq(attachments.id, id)).get();
      if (!before || before.deletedAt !== null) return false;
      withUnitOfWork(deps, ({ tx, now, audit }) => {
        tx.update(attachments)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(attachments.id, id))
          .run();
        audit({ entity: 'attachments', entityId: id, action: 'delete', before });
      });
      return true;
    },

    listFor(transactionId: string) {
      return db
        .select()
        .from(attachments)
        .where(and(eq(attachments.transactionId, transactionId), isNull(attachments.deletedAt)))
        .all();
    },

    /** Every path the DB still references (live or in Trash): never delete these files. */
    referencedPaths(): Set<string> {
      return new Set(
        deps.sql.all<{ p: string }>('SELECT file_path AS p FROM attachments').map((r) => r.p),
      );
    },

    totalBytes(): number {
      return (
        deps.sql.all<{ n: number | null }>('SELECT sum(size_bytes) AS n FROM attachments')[0]?.n ??
        0
      );
    },
  };
}

export type AttachmentsRepository = ReturnType<typeof createAttachmentsRepository>;
