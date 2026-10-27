/**
 * Drizzle table definitions used for typed queries. The SQL in
 * `migrations/` is the source of truth for DDL; `tests/node/data/schema-drift`
 * fails if the two disagree.
 */
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const common = {
  id: text('id').primaryKey().notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  version: integer('version').notNull().default(1),
};

const bool = (name: string) => integer(name, { mode: 'boolean' }).notNull();

export const accounts = sqliteTable('accounts', {
  ...common,
  name: text('name').notNull(),
  type: text('type', {
    enum: ['cash', 'bank', 'mobile_wallet', 'card', 'savings', 'other'],
  }).notNull(),
  currency: text('currency').notNull(),
  openingBalanceMinor: integer('opening_balance_minor').notNull().default(0),
  openedOn: text('opened_on'),
  icon: text('icon'),
  color: text('color'),
  isArchived: bool('is_archived').default(false),
  includeInTotals: bool('include_in_totals').default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const categories = sqliteTable('categories', {
  ...common,
  name: text('name').notNull(),
  kind: text('kind', { enum: ['expense', 'income'] }).notNull(),
  parentId: text('parent_id'),
  icon: text('icon'),
  color: text('color'),
  isSystem: bool('is_system').default(false),
  isArchived: bool('is_archived').default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const payees = sqliteTable('payees', {
  ...common,
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
});

export const tags = sqliteTable('tags', {
  ...common,
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  color: text('color'),
});

export const recurringRules = sqliteTable('recurring_rules', {
  ...common,
  rrule: text('rrule').notNull(),
  tz: text('tz').notNull(),
  templateJson: text('template_json').notNull(),
  mode: text('mode', { enum: ['auto_post', 'remind_only', 'confirm_before_post'] }).notNull(),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on'),
  maxOccurrences: integer('max_occurrences'),
  nextRunAt: integer('next_run_at'),
  lastRunAt: integer('last_run_at'),
  isPaused: bool('is_paused').default(false),
});

export const transactions = sqliteTable('transactions', {
  ...common,
  type: text('type', { enum: ['expense', 'income', 'transfer'] }).notNull(),
  accountId: text('account_id').notNull(),
  toAccountId: text('to_account_id'),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  toAmountMinor: integer('to_amount_minor'),
  toCurrency: text('to_currency'),
  fxRateToBase: text('fx_rate_to_base').notNull(),
  baseAmountMinor: integer('base_amount_minor').notNull(),
  occurredAt: integer('occurred_at').notNull(),
  occurredTz: text('occurred_tz').notNull(),
  occurredOn: text('occurred_on').notNull(),
  payeeId: text('payee_id'),
  note: text('note'),
  status: text('status', { enum: ['posted', 'pending_recurring', 'void'] })
    .notNull()
    .default('posted'),
  recurringRuleId: text('recurring_rule_id'),
  recurrenceKey: text('recurrence_key'),
});

export const transactionSplits = sqliteTable('transaction_splits', {
  ...common,
  transactionId: text('transaction_id').notNull(),
  categoryId: text('category_id').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  note: text('note'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const attachments = sqliteTable('attachments', {
  ...common,
  transactionId: text('transaction_id').notNull(),
  filePath: text('file_path').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
});

export const transactionTags = sqliteTable(
  'transaction_tags',
  {
    transactionId: text('transaction_id').notNull(),
    tagId: text('tag_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] })],
);

export const budgets = sqliteTable('budgets', {
  ...common,
  categoryId: text('category_id'),
  period: text('period', { enum: ['monthly', 'weekly', 'custom'] }).notNull(),
  customStart: text('custom_start'),
  customEnd: text('custom_end'),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  rollover: bool('rollover').default(false),
  alertThresholds: text('alert_thresholds').notNull().default('[50,80,100]'),
});

export const budgetAlertsSent = sqliteTable(
  'budget_alerts_sent',
  {
    budgetId: text('budget_id').notNull(),
    periodStart: text('period_start').notNull(),
    threshold: integer('threshold').notNull(),
    sentAt: integer('sent_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.budgetId, t.periodStart, t.threshold] })],
);

export const goals = sqliteTable('goals', {
  ...common,
  name: text('name').notNull(),
  targetMinor: integer('target_minor').notNull(),
  currency: text('currency').notNull(),
  targetDate: text('target_date'),
  linkedAccountId: text('linked_account_id'),
});

export const fxRates = sqliteTable('fx_rates', {
  ...common,
  base: text('base').notNull(),
  quote: text('quote').notNull(),
  rate: text('rate').notNull(),
  asOf: text('as_of').notNull(),
  source: text('source', { enum: ['manual'] })
    .notNull()
    .default('manual'),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey().notNull(),
  batchId: text('batch_id').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action', {
    enum: ['create', 'update', 'delete', 'restore', 'purge'],
  }).notNull(),
  beforeJson: text('before_json'),
  afterJson: text('after_json'),
  at: integer('at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey().notNull(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const schema = {
  accounts,
  categories,
  payees,
  tags,
  recurringRules,
  transactions,
  transactionSplits,
  attachments,
  transactionTags,
  budgets,
  budgetAlertsSent,
  goals,
  fxRates,
  auditLog,
  settings,
};

export type Schema = typeof schema;
