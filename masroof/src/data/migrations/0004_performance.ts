/**
 * Phase 5 — performance on a 73k-row ledger (docs/PERFORMANCE.md).
 * - Covering partial indexes for account balances (Home, net worth, goals):
 *   the sums read only index pages, never table rows (status/deleted_at are
 *   repeated as columns because SQLite still reads them to check the filter).
 * - created_at index so "recent categories" (quick add) reads the newest
 *   entries instead of grouping the whole history.
 */
export const migration0004 = {
  version: 4,
  name: 'performance',
  statements: [
    `CREATE INDEX transactions_balance_from ON transactions(account_id, occurred_on, type, amount_minor, status, deleted_at)
       WHERE deleted_at IS NULL AND status = 'posted'`,
    `CREATE INDEX transactions_balance_to ON transactions(to_account_id, occurred_on, to_amount_minor, status, deleted_at)
       WHERE deleted_at IS NULL AND status = 'posted' AND to_account_id IS NOT NULL`,
    `CREATE INDEX transactions_created ON transactions(created_at DESC) WHERE deleted_at IS NULL`,
  ],
} as const;
