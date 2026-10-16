# Journey test coverage

Every journey path from spec section 8 that is in scope so far, and the automated tests that cover it.
`node` = Jest Node project (real SQLite), `ui` = Jest + React Native Testing Library, `e2e` = Maestro flow (written; needs a device runner, see OPEN_QUESTIONS Q9).

## J1 Onboarding

| Path                                                              | Tests                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Arabic → RTL, SDG, first account, Home                         | node `services/onboarding.test.ts` "happy path"; ui `screens.test.tsx` "language → currency → account → done"; i18n RTL `i18n.test.ts`; e2e `j1-onboarding.yaml`    |
| ✅ …sets PIN + Face ID                                            | **Phase 2** (app lock). The onboarding step `security` is reserved; see OPEN_QUESTIONS Q16                                                                          |
| ❌ Skip everything → device defaults, "Cash", empty Home with CTA | node "skip everything"; ui "skip everything applies device defaults", Home "empty ledger"; e2e `flows/_onboard-skip.yaml`                                           |
| ❌ Killed mid-onboarding → resumes, no half-created accounts      | node "killed mid-step" and "resuming never duplicates"; `repositories.test.ts` "re-entrant unit of work"; ui "resumes at the step after…"; e2e `j1-onboarding.yaml` |
| ❌ Biometrics unavailable → option hidden                         | **Phase 2**                                                                                                                                                         |

## J2 Add expense

| Path                                                              | Tests                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ ≤ 3 taps; calendar marker and totals update instantly          | node `quick-add-form.test.ts` "3 taps", `ledger-journeys.test.ts` "saves, updates day markers…"; ui `quick-add.test.tsx` "happy path", `screens.test.tsx` "marks days ▲/▼"; e2e `j2-add-expense.yaml` |
| ✅ …budget alert fires                                            | **Phase 3** (budgets)                                                                                                                                                                                 |
| ❌ Amount 0 / negative / empty / > 15 digits                      | node `calculator.test.ts`, `money.test.ts`, `ledger.test.ts`, `ledger-journeys.test.ts` "rejects amount…"; ui "zero amount", "more than 15 digits"                                                    |
| ❌ Invalid expression `12++` → error, keeps last valid            | node `calculator.test.ts`, `quick-add-form.test.ts` "12++"; ui "invalid expression 12++"; e2e                                                                                                         |
| ❌ Future date → "Scheduled", excluded from spent so far          | node `ledger-journeys.test.ts` "future date", `ledger.test.ts`; ui "future date", Home "scheduled expenses are shown separately"                                                                      |
| ❌ Date before account opening → warning, allowed                 | node `ledger.test.ts`, `ledger-journeys.test.ts`                                                                                                                                                      |
| ❌ Photo permission denied → explain + Settings link; still saves | ui "photo permission denied"                                                                                                                                                                          |
| ❌ Storage full → transaction saves, retry, no orphan files       | node `attachments.test.ts` "storage full", "sweeps orphans"; ui "storage full keeps the transaction and offers retry"                                                                                 |
| ❌ Backgrounded mid-entry → draft kept 10 minutes                 | node `repositories.test.ts` drafts, `ledger.test.ts` drafts, `quick-add-form.test.ts` reviveDraft; ui "draft restored on reopen"                                                                      |

## J3 Split transaction

| Path                                                 | Tests                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ✅ $123 → Clothes 80 + Kids 43; reports reflect both | node `ledger-journeys.test.ts` J3, `ledger.test.ts`; ui "live remaining…saves both parts"; e2e `j3-split.yaml`    |
| ❌ Splits don't sum → live remaining, save blocked   | node `quick-add-form.test.ts`, `ledger-journeys.test.ts`, `constraints.test.ts` integrity; ui; e2e                |
| ❌ Remove split mode → collapse after confirmation   | node `quick-add-form.test.ts` "collapses to the largest category"; ui "removing split mode asks for confirmation" |

## J4 Transfer

| Path                                                           | Tests                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ✅ Bank → Cash; both balances move; not income/expense         | node `ledger-journeys.test.ts`; ui Home "balance tab"; e2e `j4-transfer.yaml`                                                  |
| ✅ USD bank → SDG wallet; both amounts; rate derived and shown | node `ledger-journeys.test.ts`, `fx-format.test.ts` deriveRate; ui "cross-currency"                                            |
| ❌ Same source and destination → blocked                       | node `constraints.test.ts` (DB CHECK), `ledger.test.ts`, `ledger-journeys.test.ts`; ui "cannot pick the source as destination" |
| ❌ From archived account → blocked                             | node `ledger.test.ts`, `ledger-journeys.test.ts`                                                                               |
| ❌ Insufficient balance → warning only                         | node `ledger.test.ts`, `ledger-journeys.test.ts`; ui "insufficient balance shows a warning"                                    |

## J7 Edit / delete / undo

| Path                                                                       | Tests                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Delete → undo snackbar → exact restore (splits, tags, attachments)      | node `ledger-journeys.test.ts` "restores exactly", "does not resurrect splits replaced by an earlier edit"; ui `screens.test.tsx` "Undo restores exactly", `undo.test.tsx` 5 s window; e2e `j7-delete-undo.yaml` |
| ❌ Undo missed → Trash for 30 days                                         | node "in Trash for 30 days, then purged with its files and history"; ui `screens.test.tsx` Trash; e2e                                                                                                            |
| ❌ Editing a recurring-generated transaction → this only / this and future | node "requires a scope; this and future updates the rule"; ui "recurring-generated: asks…"                                                                                                                       |
