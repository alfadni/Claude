/**
 * Tables included in a backup, in foreign-key-safe insert order (parents
 * first). Restores delete in reverse order. `drafts` is scratch state and is
 * deliberately excluded. Table names are only ever taken from this list,
 * never from a backup file.
 */
export const BACKUP_TABLES = [
  'settings',
  'accounts',
  'categories',
  'payees',
  'tags',
  'recurring_rules',
  'transactions',
  'transaction_splits',
  'attachments',
  'transaction_tags',
  'budgets',
  'budget_alerts_sent',
  'goals',
  'fx_rates',
  'audit_log',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];
