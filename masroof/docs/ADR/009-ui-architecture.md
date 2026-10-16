# ADR-009: UI architecture — injected session, versioned read models, pure form state

- Status: Accepted (Phase 1)
- Date: 2026-10-16

## Decision

- **Session injection:** screens read `useSession()` (repositories, services, settings, platform ports) from a React context. The app fills it from the boot store; tests fill it from an in-memory SQLite ledger (`tests/ui/ledger-session.tsx`). Route files in `app/` are thin adapters that pass navigation callbacks.
- **Read models:** repository reads are synchronous (SQLite on the JS thread, small indexed queries). `useLedger(read, deps)` memoises a read on `(deps, version)`. Every write calls `session.bump()`, so the calendar, totals and lists update immediately after a save (J2) without a cache library. TanStack Query (optional in the spec) is not needed yet.
- **Forms as pure state machines:** quick add is `form-state.ts` (a reducer plus `derive()`), with no React. Every J2/J3/J4 rule, including the calculator, splits, transfer legs and rate, is unit-tested in Node. The screen only renders and dispatches. Domain `validateTransaction` runs live for errors and warnings, and the repository re-validates on write.
- **Pagination:** the transaction list uses keyset pagination on `(occurred_at, id)` with a partial index, 50 rows per page. Page 1 is a read model, and later pages are discarded when filters or data change.
- **Undo:** one global snackbar (`undo-store`) with a 5-second window. Undo calls `restore()`, which brings back exactly the children deleted with the parent (same `deleted_at`).
- **RTL:** the layout uses logical properties throughout, except the calculator keypad, which deliberately keeps a left-to-right digit grid (`direction: 'ltr'`) as phone keypads do in Arabic locales. Month chevrons swap glyphs under RTL.
