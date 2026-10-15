# ADR-007: Testing strategy

- Status: Accepted (Phase 0)
- Date: 2026-10-15

## Decision

Jest 30 with two projects (`jest.config.js`):

- **node:** domain, data, services and i18n. Runs on `babel-preset-expo` in plain Node, with **real SQLite via better-sqlite3**, so constraints, migrations and the Drizzle queries in repositories are exercised for real. SQLCipher behaviour (wrong key ⇒ "file is not a database") is simulated by a fake connection in `tests/node/services/open-database.test.ts`.
- **ui:** `jest-expo` preset + React Native Testing Library 14 (async `render`).
- Coverage gate: `src/domain/` must stay at ≥ 90% statements, branches, functions and lines (currently ≥ 97% on every metric).
- **E2E:** Maestro flows in `e2e/` against a dev or release build. These can't run in CI without a simulator, so in each phase report they're listed as "written, not executed" until a macOS/emulator runner exists (OPEN_QUESTIONS Q9).
- CI also runs a Metro/Hermes `expo export` for Android, which catches bundling errors that `tsc` misses.

## Journey test rule

Every journey in spec §8 gets automated tests for its happy path and each listed negative path, in the phase that builds it. Phase 0 builds no journeys, but already covers the foundation pieces several journeys rely on (see README "Phase 0 coverage of journey prerequisites").
