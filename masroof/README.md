# Masroof (مصروف)

Offline-first personal expense and income tracker for iOS and Android. Data never leaves the device: it is stored in an SQLCipher-encrypted database whose key lives in the Keychain / Android Keystore.

> Status: **Phase 4 — Multi-currency & insights** complete (on top of Phases 0–3). See [`docs/ADR`](docs/ADR) for decisions, [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) for choices awaiting your confirmation, and [`docs/JOURNEY_COVERAGE.md`](docs/JOURNEY_COVERAGE.md) for which test covers which journey path.

## What works today

- **Onboarding** (J1): language (EN/AR, RTL), base currency, first account; skippable (device defaults applied); resumable if the app is killed.
- **Calendar home**: month calendar with ▲ income / ▼ expense day markers, month switcher, Income / Balance / Expense tabs, category bars, "spent so far" vs scheduled, net worth across included accounts.
- **Quick add** (J2): keypad with calculator (`12+8.5`), recent categories first, last-used account, today / yesterday / any date, note, payee, tags, up to 5 encrypted receipt photos, drafts kept 10 minutes.
- **Splits** (J3) with a live "remaining" indicator; **transfers** (J4), including cross-currency with a derived rate.
- **Transactions list**: search (note, payee, amount), filters (date, type, account, category, tag), grouping by day or category, pagination.
- **Edit / delete / undo** (J7): 5-second undo snackbar, 30-day Trash, edit scope prompt for recurring-generated transactions.
- **Accounts** (cash, bank, mobile wallet, card, savings, other; archive, include-in-totals, currency locked once used) and **categories** (add, rename, reorder, archive; never hard-deleted).
- **App lock** (J8): PIN (Argon2id) and Face ID / fingerprint. Locks on start and after a timeout. Escalating cool-downs, never a wipe. A biometric change forces the PIN. Privacy cover in the app switcher.
- **Encrypted backup & restore** (J9): `.masroof` files (Argon2id + AES-256-GCM), shared via the OS share sheet. Restore shows a preview, verifies everything before writing, migrates old backups forward, and saves a safety backup before replacing data.
- **CSV export & import**: export carries a plain-text warning and a formula-injection guard. Import shows a preview with row-level errors, category mapping and duplicate skipping, and commits all-or-nothing.
- **Reset** (J11): offers a backup first, requires typing `RESET`, and wipes in a safe order.
- **Recurring transactions** (J5, ADR-013): "Repeat…" on any transaction.
  - Schedules: daily, weekly (chosen weekdays), monthly (a day or the last day; the 31st clamps to short months) or yearly, every _n_ periods, with an optional end date or count.
  - Three modes: record automatically, ask first, or remind only.
  - The engine runs on open, when the app returns on a new day, and from background fetch. It is idempotent (`rule_id:date` key) and never duplicates or deletes, even if the clock moves backwards.
  - A back-fill of more than 3 goes to review. The **Upcoming** inbox handles confirm / change amount / skip.
- **Budgets** (J6, ADR-014):
  - Monthly or weekly, per category (including sub-categories) or overall, with optional rollover.
  - Alerts at 50/75/80/90/100%; each fires once per period, even after edits or deletes.
  - "Safe to spend today", and a Home health strip (✓ / ⚠ / ⛔ plus text, never colour alone).
  - Category merge moves budgets, splits and rules; if both categories have a budget, it asks first.
- **Goals**: target, optional date and linked account; progress and the monthly amount needed.
- **Exchange rates & main currency** (J10, ADR-015): a manual FX table (add, edit, delete). Changing the main currency lists every rate it needs (prefilled from the table), previews this month's totals before and after, and recomputes every frozen base amount and budget in one transaction. Original amounts and currencies never change, and it is blocked until every rate is given.
- **Reports** (ADR-016): income vs expense, 12-month trend, spending by category, month-over-month change per category, top payees and goal progress. Charts are accessible native bars (no chart library); each bar is read aloud.
- **Local notifications**: asked in context (first rule or budget), never at launch. They never contain amounts. With permission denied, everything still works in-app.

## Requirements

- Node ≥ 22, pnpm 10 (`corepack enable`)
- For running on a device or simulator: Xcode / Android Studio. **Expo Go is not supported**: it lacks SQLCipher, and the app refuses to store data unencrypted.

## Commands

```bash
pnpm install
pnpm ios | pnpm android   # builds a dev client with SQLCipher (expo run:*) and starts Metro
pnpm start                # Metro only, for an already-installed dev client

pnpm lint                 # ESLint (incl. RTL, no-float-money, layering, no-console rules)
pnpm format:check
pnpm typecheck
pnpm test                 # Jest: node project (real SQLite) + ui project (RNTL)
pnpm test:coverage        # enforces ≥ 90% on src/domain
pnpm e2e                  # Maestro flows in e2e/ (needs a running dev/release build)
```

Release builds: `npx eas-cli@latest build` (EAS config arrives in Phase 5).

## Architecture

```
app/            Expo Router screens (thin; compose features + ui)
src/domain/     pure TS: Money, FX, calculator, formatting, LocalDate, Period, ids, ledger rules
src/data/       SQL migrations, Drizzle schema, unit of work + audit, repositories, read models
src/services/   encrypted DB + key lifecycle, attachments, backup, CSV, lock, recurrence engine, notifications
src/features/   screens + pure form state (home, quick-add, transactions, accounts, categories…)
src/ui/         tokens, theme, RTL-safe primitives, AmountText, empty/loading/error states
src/i18n/       en / ar resources, locale resolution, layout direction
tests/node      domain + data + services + i18n (Node, better-sqlite3)
tests/ui        screens against an in-memory ledger (jest-expo + Testing Library)
e2e/            Maestro journey flows (j1–j11)
```

Layering is `ui → features → services → domain ← data`, enforced by ESLint `no-restricted-imports`.

## Guardrails that run on every commit and in CI

| Rule                    | Enforced by                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| No floating-point money | STRICT tables reject REAL in INTEGER columns; ESLint bans `parseFloat` and `.toFixed`; a test asserts no REAL columns exist |
| No user data in logs    | ESLint `no-console: error`; error messages exclude values (tested)                                                          |
| RTL-safe layout         | ESLint bans `left/right/marginLeft/...` and `textAlign: left/right` in UI code                                              |
| Contrast ≥ 4.5:1        | `tests/node/ui/tokens.test.ts` checks every listed token pair in light and dark                                             |
| EN/AR parity            | `tests/node/i18n/i18n.test.ts`                                                                                              |
| Schema = ORM            | Drift test compares the Drizzle tables with the migrated DDL                                                                |
| No `any`                | `@typescript-eslint/no-explicit-any: error` + TS strict                                                                     |

## Journey coverage

See [`docs/JOURNEY_COVERAGE.md`](docs/JOURNEY_COVERAGE.md). Phases 1–4 cover every journey, J1–J11.
