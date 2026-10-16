# ADR-005: UUID v7 ids, append-only audit log, unit of work

- Status: Accepted (Phase 0)
- Date: 2026-10-15

## Decision

- **IDs:** UUID v7 (RFC 9562), generated in `src/domain/shared/id.ts` with injected randomness (expo-crypto on device, seeded in tests). A 12-bit per-millisecond sequence keeps ids monotonic even when the clock stalls or steps backwards (J5 clock-skew case).
- **Unit of work:** `withUnitOfWork(deps, fn)` is the only write path. It opens a DB transaction and supplies an `audit()` writer, and all audit rows of one user action share a `batch_id`. If `fn` throws, data and audit rows roll back together (tested).
- **audit_log** holds before/after JSON and is append-only (a trigger blocks UPDATE). It is the basis for undo (J7) and the v2 `SyncAdapter`. It sits inside the encrypted DB and is never logged.
- Repositories take a `DataDeps` object (`db`, `sql`, `now`, `newId`), so tests control time and ids deterministically.
