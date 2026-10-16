/**
 * Phase 1 — core ledger.
 * - categories.seed_key: default categories are localised by key until renamed.
 * - transaction_splits.base_amount_minor: base-currency share of each split,
 *   allocated at write time so category reports sum exactly to the parent.
 * - drafts: quick-add drafts kept inside the encrypted DB (J2: 10 minutes).
 */
export const migration0002 = {
  version: 2,
  name: 'ledger',
  statements: [
    `ALTER TABLE categories ADD COLUMN seed_key TEXT`,
    `CREATE UNIQUE INDEX categories_seed_key ON categories(seed_key) WHERE seed_key IS NOT NULL`,

    `ALTER TABLE transaction_splits ADD COLUMN base_amount_minor INTEGER NOT NULL DEFAULT 0`,
    // Backfill proportionally for any rows written before this column existed.
    `UPDATE transaction_splits SET base_amount_minor = (
       SELECT CASE WHEN t.amount_minor = 0 THEN 0
                   ELSE (transaction_splits.amount_minor * t.base_amount_minor) / t.amount_minor END
       FROM transactions t WHERE t.id = transaction_splits.transaction_id)`,

    `CREATE TABLE drafts (
      key TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL CHECK (json_valid(payload)),
      saved_at INTEGER NOT NULL
    ) STRICT`,

    `CREATE INDEX transactions_occurred_at ON transactions(occurred_at DESC, id DESC) WHERE deleted_at IS NULL`,
    `CREATE INDEX transactions_deleted ON transactions(deleted_at) WHERE deleted_at IS NOT NULL`,
  ],
} as const;
