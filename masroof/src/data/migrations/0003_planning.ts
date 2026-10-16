/**
 * Phase 3 — planning (ADR-013, ADR-014).
 * - recurring_rules cursor: next_occurrence_on (first occurrence not yet
 *   generated), occurrence_count (for max_occurrences), last_error (why the
 *   rule could not post; the cursor stays put until fixed).
 * - The Upcoming inbox reads pending occurrences by status.
 * - At most one live monthly/weekly budget per category (or overall).
 */
export const migration0003 = {
  version: 3,
  name: 'planning',
  statements: [
    `ALTER TABLE recurring_rules ADD COLUMN next_occurrence_on TEXT
       CHECK (next_occurrence_on IS NULL OR next_occurrence_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`,
    `ALTER TABLE recurring_rules ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 0
       CHECK (occurrence_count >= 0)`,
    `ALTER TABLE recurring_rules ADD COLUMN last_error TEXT`,

    `CREATE INDEX transactions_pending ON transactions(occurred_on)
       WHERE status = 'pending_recurring' AND deleted_at IS NULL`,
    `CREATE UNIQUE INDEX budgets_category_period ON budgets(coalesce(category_id, ''), period)
       WHERE deleted_at IS NULL AND period <> 'custom'`,
    `CREATE INDEX budgets_category ON budgets(category_id) WHERE category_id IS NOT NULL`,
    `CREATE INDEX goals_account ON goals(linked_account_id) WHERE linked_account_id IS NOT NULL`,
  ],
} as const;
