# Performance (Phase 5)

The spec's target is a ledger of **73,000 transactions**: about 20 years at 10 a day. `tests/helpers/seed.ts` builds one deterministically, with the same row shapes the repositories write:

- about 8% income and 4% transfers;
- 10% of expenses split three ways;
- 200 payees and some notes.

`tests/perf/large-ledger.test.ts` runs in CI on every push (Jest project `perf`).

## Measured (Node 22, better-sqlite3, CI-class Linux VM)

| Read model / operation                    | Before Phase 5 | After         | CI budget |
| ----------------------------------------- | -------------- | ------------- | --------- |
| Transactions list, first page (50)        | 1.2 ms         | 1.1 ms        | 50 ms     |
| Text search / category filter             | ~1 ms          | ~1 ms         | 150 ms    |
| Calendar day summaries, period totals     | < 1 ms         | < 1 ms        | 50 ms     |
| 12-month trend                            | 2.6 ms         | 2.9 ms        | 100 ms    |
| Account balances (Home, net worth, goals) | 19.8 ms        | 10 ms         | 100 ms    |
| Recent categories (quick add)             | 93 ms          | < 5 ms (warm) | 100 ms    |
| Budget statuses, engine run               | 5 ms           | 5 ms          | 100 ms    |
| CSV export of everything                  | 1.3 s          | 0.8 s         | 5 s       |
| J10 required rates                        | 189 ms         | 22 ms         | 200 ms    |
| J10 preview                               | 2.0 s          | 34 ms         | 300 ms    |
| J10 apply (73k rows, one transaction)     | 12.1 s         | 1.6 s         | 15 s      |

The budgets are deliberately loose so they only catch order-of-magnitude regressions on slower CI machines. **Phones are slower**: expect roughly 3–5× on mid-range Android with Hermes. A device run is still pending (OPEN_QUESTIONS Q47).

## Changes

- **Migration 4** (`0004_performance.ts`) adds three indexes:
  - Two **covering partial indexes** for account balances. The columns are `(account_id | to_account_id, occurred_on, type, amount, status, deleted_at)`, with the filter `deleted_at IS NULL AND status = 'posted'`. The balance sums read only index pages.
  - `transactions(created_at DESC)`, so "recent categories" reads the newest 300 entries instead of grouping 73k rows.
- **Bulk writes:** `SqlExecutor.runMany` runs one prepared statement for many rows (`prepareSync`/`executeSync` on device). The J10 rewrite uses it, which removed a per-row statement compile.
- **J10 preview** recomputes only the current month. Apply uses the same `rebase()` for every row, and a test asserts that the applied totals equal the preview on the full 73k-row ledger.
- **J10 required rates** are now a `GROUP BY` in SQL, with no rows copied into JS.

## Query-plan guards

These assertions are exact (`EXPLAIN QUERY PLAN`), so they don't depend on machine speed:

| Query               | Index it must use                     |
| ------------------- | ------------------------------------- |
| Balances (outgoing) | `transactions_balance_from`, covering |
| Balances (incoming) | `transactions_balance_to`, covering   |
| Month totals        | `transactions_occurred_on`            |
| List paging         | `transactions_occurred_at`            |
| Recent categories   | `transactions_created`                |
