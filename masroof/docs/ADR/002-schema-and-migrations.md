# ADR-002: Schema v1, STRICT tables, hand-written migrations

- Status: Accepted (Phase 0)
- Date: 2026-10-15

## Decision

- **The full §4 data model ships as migration 0001 now.** Later phases add features on top of it, so they rarely need structural migrations. Two extra columns/tables were added because journeys need them:
  - `transactions.occurred_on`: the local calendar date in `occurred_tz`, indexed (ADR-004).
  - `transactions.recurrence_key UNIQUE`: J5 idempotency (`rule_id:occurrence_date`).
  - `transactions.to_amount_minor` / `to_currency`: the second leg of a cross-currency transfer (J4, §4 "store both legs").
  - `budget_alerts_sent`: J6 "previously sent alerts don't re-fire for the same threshold in the same period".
  - `accounts.opened_on`: J2 "date before account opening" warning.
  - `audit_log.batch_id`: undo reverses one user action, which can span several rows.
- **STRICT tables.** SQLite rejects `10.5` in an INTEGER column, so floating-point money cannot reach storage even through a bug. A test also asserts that no column has REAL/NUMERIC affinity.
- **Constraints as the last line of defence:** amount > 0, transfer ⇔ `to_account_id`, source ≠ destination, upper-case 3-letter currency codes, JSON validity, and an append-only `audit_log` (trigger).
- **Migrations are hand-written SQL in TS modules**, tracked with `PRAGMA user_version`. Each migration and its version bump run in one transaction, so a crash leaves the DB at the previous version. A DB from a newer app is left untouched (`newer_than_app`).
- Drizzle is used for typed queries only. `tests/node/data/migrations.test.ts` fails if a Drizzle table disagrees with the migrated DDL.

## Why not drizzle-kit's generated migrator

It can't express triggers, partial indexes and STRICT as cleanly. It also needs bundler tricks to inline `.sql` files in Metro. Plain TS string arrays run the same way under Metro and Jest.

## Known limitation

SQLite has no deferred cross-row CHECK, so "sum of splits = parent amount" can't be a DB constraint. It is enforced in the domain and repository layers (Phase 1), and detected by `integrityReport()` (counts only, no amounts), which tests and diagnostics call.
