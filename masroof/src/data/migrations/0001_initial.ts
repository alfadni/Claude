/**
 * Schema v1 — the full §4 data model.
 *
 * Conventions
 * - ids: UUID v7 text. Timestamps: INTEGER epoch ms (UTC).
 * - Soft delete via deleted_at; `version` increments on every update (v2 sync).
 * - Money: INTEGER minor units; rates: TEXT decimals. No REAL column anywhere.
 * - Booleans: INTEGER 0/1 with CHECK.
 *
 * Invariants SQLite cannot express (sum of splits = parent amount) are enforced
 * in the domain and repositories, and verified by `integrityReport`.
 */
const COMMON = `
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)`;

const bool = (col: string, dflt: 0 | 1) =>
  `${col} INTEGER NOT NULL DEFAULT ${dflt} CHECK (${col} IN (0, 1))`;

const currency = (col: string, nullable = false) =>
  `${col} TEXT${nullable ? '' : ' NOT NULL'} CHECK (${col} IS NULL OR (length(${col}) = 3 AND ${col} = upper(${col})))`;

export const migration0001 = {
  version: 1,
  name: 'initial',
  statements: [
    `CREATE TABLE accounts (${COMMON},
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      type TEXT NOT NULL CHECK (type IN ('cash','bank','mobile_wallet','card','savings','other')),
      ${currency('currency')},
      opening_balance_minor INTEGER NOT NULL DEFAULT 0,
      opened_on TEXT,
      icon TEXT,
      color TEXT,
      ${bool('is_archived', 0)},
      ${bool('include_in_totals', 1)},
      sort_order INTEGER NOT NULL DEFAULT 0
    ) STRICT`,

    `CREATE TABLE categories (${COMMON},
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
      parent_id TEXT REFERENCES categories(id),
      icon TEXT,
      color TEXT,
      ${bool('is_system', 0)},
      ${bool('is_archived', 0)},
      sort_order INTEGER NOT NULL DEFAULT 0,
      CHECK (parent_id IS NULL OR parent_id <> id)
    ) STRICT`,

    `CREATE TABLE payees (${COMMON},
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      normalized_name TEXT NOT NULL
    ) STRICT`,
    `CREATE UNIQUE INDEX payees_normalized_name_live ON payees(normalized_name) WHERE deleted_at IS NULL`,

    `CREATE TABLE tags (${COMMON},
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      normalized_name TEXT NOT NULL,
      color TEXT
    ) STRICT`,
    `CREATE UNIQUE INDEX tags_normalized_name_live ON tags(normalized_name) WHERE deleted_at IS NULL`,

    `CREATE TABLE recurring_rules (${COMMON},
      rrule TEXT NOT NULL,
      tz TEXT NOT NULL,
      template_json TEXT NOT NULL CHECK (json_valid(template_json)),
      mode TEXT NOT NULL CHECK (mode IN ('auto_post','remind_only','confirm_before_post')),
      starts_on TEXT NOT NULL,
      ends_on TEXT,
      max_occurrences INTEGER CHECK (max_occurrences IS NULL OR max_occurrences > 0),
      next_run_at INTEGER,
      last_run_at INTEGER,
      ${bool('is_paused', 0)}
    ) STRICT`,

    `CREATE TABLE transactions (${COMMON},
      type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      to_account_id TEXT REFERENCES accounts(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      ${currency('currency')},
      to_amount_minor INTEGER CHECK (to_amount_minor IS NULL OR to_amount_minor > 0),
      ${currency('to_currency', true)},
      fx_rate_to_base TEXT NOT NULL,
      base_amount_minor INTEGER NOT NULL,
      occurred_at INTEGER NOT NULL,
      occurred_tz TEXT NOT NULL,
      occurred_on TEXT NOT NULL CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      payee_id TEXT REFERENCES payees(id),
      note TEXT,
      status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','pending_recurring','void')),
      recurring_rule_id TEXT REFERENCES recurring_rules(id),
      recurrence_key TEXT UNIQUE,
      CHECK ((type = 'transfer') = (to_account_id IS NOT NULL)),
      CHECK (to_account_id IS NULL OR to_account_id <> account_id),
      CHECK (type <> 'transfer' OR (to_amount_minor IS NOT NULL AND to_currency IS NOT NULL)),
      CHECK (type = 'transfer' OR (to_amount_minor IS NULL AND to_currency IS NULL)),
      CHECK ((recurrence_key IS NULL) OR (recurring_rule_id IS NOT NULL))
    ) STRICT`,
    `CREATE INDEX transactions_occurred_on ON transactions(occurred_on) WHERE deleted_at IS NULL`,
    `CREATE INDEX transactions_account_on ON transactions(account_id, occurred_on) WHERE deleted_at IS NULL`,
    `CREATE INDEX transactions_to_account ON transactions(to_account_id) WHERE to_account_id IS NOT NULL`,
    `CREATE INDEX transactions_payee ON transactions(payee_id) WHERE payee_id IS NOT NULL`,
    `CREATE INDEX transactions_rule ON transactions(recurring_rule_id) WHERE recurring_rule_id IS NOT NULL`,

    `CREATE TABLE transaction_splits (${COMMON},
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      note TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    ) STRICT`,
    `CREATE INDEX splits_transaction ON transaction_splits(transaction_id)`,
    `CREATE INDEX splits_category ON transaction_splits(category_id) WHERE deleted_at IS NULL`,

    `CREATE TABLE attachments (${COMMON},
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      mime TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
    ) STRICT`,
    `CREATE INDEX attachments_transaction ON attachments(transaction_id)`,

    `CREATE TABLE transaction_tags (
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (transaction_id, tag_id)
    ) STRICT, WITHOUT ROWID`,
    `CREATE INDEX transaction_tags_tag ON transaction_tags(tag_id)`,

    `CREATE TABLE budgets (${COMMON},
      category_id TEXT REFERENCES categories(id),
      period TEXT NOT NULL CHECK (period IN ('monthly','weekly','custom')),
      custom_start TEXT,
      custom_end TEXT,
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      ${currency('currency')},
      ${bool('rollover', 0)},
      alert_thresholds TEXT NOT NULL DEFAULT '[50,80,100]' CHECK (json_valid(alert_thresholds)),
      CHECK ((period = 'custom') = (custom_start IS NOT NULL AND custom_end IS NOT NULL))
    ) STRICT`,

    // One row per (budget, period, threshold) ever notified: J6 "alerts don't re-fire".
    `CREATE TABLE budget_alerts_sent (
      budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
      period_start TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      sent_at INTEGER NOT NULL,
      PRIMARY KEY (budget_id, period_start, threshold)
    ) STRICT, WITHOUT ROWID`,

    `CREATE TABLE goals (${COMMON},
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      target_minor INTEGER NOT NULL CHECK (target_minor > 0),
      ${currency('currency')},
      target_date TEXT,
      linked_account_id TEXT REFERENCES accounts(id)
    ) STRICT`,

    `CREATE TABLE fx_rates (${COMMON},
      base TEXT NOT NULL CHECK (length(base) = 3),
      quote TEXT NOT NULL CHECK (length(quote) = 3),
      rate TEXT NOT NULL CHECK (rate GLOB '[0-9]*' AND rate NOT GLOB '*[^0-9.]*'),
      as_of TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
      CHECK (base <> quote)
    ) STRICT`,
    `CREATE UNIQUE INDEX fx_rates_pair_day ON fx_rates(base, quote, as_of) WHERE deleted_at IS NULL`,

    // Append-only: every mutation writes a row (undo now, sync in v2).
    `CREATE TABLE audit_log (
      id TEXT PRIMARY KEY NOT NULL,
      batch_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('create','update','delete','restore','purge')),
      before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
      after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
      at INTEGER NOT NULL
    ) STRICT`,
    `CREATE INDEX audit_entity ON audit_log(entity, entity_id)`,
    `CREATE INDEX audit_batch ON audit_log(batch_id)`,
    `CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`,

    `CREATE TABLE settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL CHECK (json_valid(value)),
      updated_at INTEGER NOT NULL
    ) STRICT`,
  ],
} as const;
