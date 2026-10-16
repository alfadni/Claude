# Masroof (مصروف)

Offline-first personal expense and income tracker for iOS and Android. Data never leaves the device: it is stored in an SQLCipher-encrypted database whose key lives in the Keychain / Android Keystore.

> Status: **Phase 0 — Foundations** complete. See [`docs/ADR`](docs/ADR) for decisions and [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) for choices awaiting your confirmation.

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
src/domain/     pure TS: Money, FX, formatting, LocalDate, Period, ids, settings rules
src/data/       SQL migrations, Drizzle schema, unit of work + audit, repositories, integrity checks
src/services/   encrypted DB opening & key lifecycle, device locale defaults
src/features/   boot, settings (more per phase)
src/ui/         tokens, theme, RTL-safe primitives, AmountText, empty/loading/error states
src/i18n/       en / ar resources, locale resolution, layout direction
tests/node      domain + data + services + i18n (Node, better-sqlite3)
tests/ui        components (jest-expo + Testing Library)
e2e/            Maestro flows
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

## Phase 0 coverage of journey prerequisites

Phase 0 has no user journeys, but these foundations already have tests for the journeys that will use them:

- J1: device-default fallbacks for "skip everything"; Arabic → RTL direction switch.
- J2: amount validation (empty / zero / negative / > 15 digits / too many decimals / Arabic digits).
- J3: lossless `allocate`; DB integrity check detects split totals that don't match.
- J4: same-account transfer rejected by the DB; cross-currency rate derivation.
- J5: month-end clamping (rule on the 31st); `recurrence_key` uniqueness; ids that stay monotonic under clock skew.
- J9: a database from a newer schema is refused and left untouched; failed migrations roll back.
- §7: key lifecycle (first launch, reuse, key lost, wrong key, no SQLCipher, keystore failure).
