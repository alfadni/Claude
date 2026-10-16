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
| ✅ …budget alert fires                                            | node `services/budgets.test.ts` "at 80% a local notification fires"; ui `boot-store.test.tsx` "every write checks budget thresholds"; e2e `j6-budget.yaml`                                            |
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

## J5 Recurring payment

| Path                                                                                                                   | Tests                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Rent monthly on the 1st, auto_post → posted on first open on/after the 1st, user notified                           | node `services/recurring.test.ts` "rent monthly on the 1st", "user notified" (background notification, no amounts); ui `boot-store.test.tsx` "engine runs on open", `phase3.test.tsx` "recorded notice"; e2e `j5-recurring.yaml` |
| ✅ confirm_before_post → Upcoming inbox; confirm / edit amount / skip                                                  | node "confirm_before_post…", "remind_only also lands in Upcoming", "multi-split template"; ui `phase3.test.tsx` "confirm posts it", "edit the amount", "skip voids it"                                                           |
| ❌ Not opened for 3 months → each missed occurrence exactly once (key = rule + date), review if > 3                    | node "app not opened for 3 months", "idempotency key holds even if the cursor was lost", "a deleted generated transaction is not recreated"; ui "back-fill > 3: review card posts all"                                           |
| ❌ Rule on the 31st → last day of shorter months                                                                       | domain `planning.test.ts` "clamps … never drifts", leap years, BYMONTHDAY=-1; node "rule on the 31st"; ui "Repeat… monthly on the last day"                                                                                      |
| ❌ Clock moved backwards → no duplicates, no deletion                                                                  | node "device clock moved backwards"                                                                                                                                                                                              |
| ❌ Notification permission denied → inbox works, banner explains                                                       | node "permission denied: in-app inbox still works", "asks in context only while undetermined"; ui "notifications denied: banner explains"                                                                                        |
| (extra) Rule can't post (archived category/account, missing rate) → nothing written, error shown, back-fill once fixed | node "archived category: the rule stops…"; ui "a rule that cannot post is shown with its reason"                                                                                                                                 |
| (extra) End date / count, pause/resume, delete rule, schedule edits                                                    | node "end date and max occurrences", "pause skips…", "deleting a rule voids pending", "changing the schedule never touches generated rows"                                                                                       |
| (extra) Background task without a key / locked keychain → does nothing                                                 | node `recurring.test.ts` "background task (headless)"                                                                                                                                                                            |

## J6 Budgets

| Path                                                                                              | Tests                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Food 400/month; at 80% a local notification, Home strip amber                                  | node `services/budgets.test.ts` "at 80% a local notification fires", "highest only"; ui `phase3.test.tsx` "reads Getting close with an icon", Home "budget strip, safe to spend"; e2e `j6-budget.yaml`                                      |
| ❌ Expense edited/deleted → recalculated; no re-fire in the same period                           | node "expense edited/deleted: recalculated, and alerts never re-fire", "recorded even when permission is denied"                                                                                                                            |
| ❌ Budget currency ≠ transaction currency → stored base amounts                                   | node "stored base amounts are used", "a budget in another currency converts its limit; with no rate, no alert"                                                                                                                              |
| ❌ Category merged/archived → budget migrates or prompts                                          | node "merged: splits, budget and rule templates migrate", "a clashing target budget prompts", "refuses unsafe merges", "category archived: flagged"; ui "clashing budgets: the user chooses to combine", "archived category budget prompts" |
| (extra) Scheduled expenses reserved; sub-categories; overall; rollover; weekly/custom; validation | node `budgets.test.ts`; domain `planning.test.ts` "budget evaluation"                                                                                                                                                                       |
| (extra) Goals: progress, monthly needed, validation                                               | domain `planning.test.ts` "goals"; node `budgets.test.ts` "goals"; ui "goals UI"                                                                                                                                                            |

## J7 Edit / delete / undo

| Path                                                                       | Tests                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Delete → undo snackbar → exact restore (splits, tags, attachments)      | node `ledger-journeys.test.ts` "restores exactly", "does not resurrect splits replaced by an earlier edit"; ui `screens.test.tsx` "Undo restores exactly", `undo.test.tsx` 5 s window; e2e `j7-delete-undo.yaml` |
| ❌ Undo missed → Trash for 30 days                                         | node "in Trash for 30 days, then purged with its files and history"; ui `screens.test.tsx` Trash; e2e                                                                                                            |
| ❌ Editing a recurring-generated transaction → this only / this and future | node "requires a scope; this and future updates the rule"; ui "recurring-generated: asks…"                                                                                                                       |

## J8 App lock

| Path                                                                           | Tests                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Return after timeout → Face ID → unlocked                                   | node `lock-policy.test.ts` auto-lock, `lock-service.test.ts` "Face ID unlocks"; ui `phase2.test.tsx` "biometrics: prompted on open", "locks after the timeout"; e2e `j8-app-lock.yaml` |
| ❌ 5 wrong PINs → escalating cool-down; no wipe                                | node `lock-policy.test.ts`, `lock-service.test.ts` "5 wrong PINs…", "clock moved backwards"; ui "5 wrong PINs → cool-down banner"; e2e                                                 |
| ❌ Biometrics changed at OS level → biometric unlock invalidated, PIN required | node "biometrics changed at OS level", "tampered biometric item"; ui "biometrics changed at OS level"                                                                                  |
| ❌ Forgot PIN, no biometrics → reset & restore path, clearly warned            | node "without biometrics: no way around the PIN"; ui "forgot PIN without biometrics"; also "forgot PIN with biometrics"                                                                |

## J9 Backup / restore / export

| Path                                                                                                     | Tests                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Backup → share → restore on a new phone → identical data and attachments (row counts + checksums)     | node `backup.test.ts` "restores identical data and attachments"; ui `phase2.test.tsx` "creates an encrypted backup, shares it"; e2e `j9-backup-restore.yaml`     |
| ❌ Wrong passphrase → clear error, no partial restore                                                    | node; ui "wrong passphrase → clear error"                                                                                                                        |
| ❌ Corrupted or truncated file → nothing written                                                         | node "a flipped byte", "truncation", "missing end", "trailing junk", "edited header"; ui "a non-backup file is rejected"                                         |
| ❌ Backup from a newer schema → "update the app"                                                         | node "backup from a newer app schema"                                                                                                                            |
| ❌ Backup from an older schema → migrated forward (fixture)                                              | node "restores a schema-v1 backup…" using `tests/fixtures/backup-schema-v1.masroof`                                                                              |
| ❌ Restore over existing data → replace (safety backup first) or cancel                                  | node "requires explicit confirmation; … safety backup", "if the safety backup cannot be written"; ui "restore over existing data asks to replace"                |
| ❌ CSV import with duplicates / bad dates / unknown categories → preview, mapping, nothing until confirm | node `csv.test.ts` (row errors, mapping, duplicates, round trip, all-or-nothing); ui "import: preview with counts and errors, map unknown category, then commit" |
| (security) Crafted backups: unknown tables, injected columns, path traversal, FK violations              | node `backup.test.ts` "crafted backups"                                                                                                                          |

## J10 Change base currency

| Path                                                                                        | Tests                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ USD → SDG with a rate → preview → confirm → base amounts recomputed; originals untouched | node `data/phase4.test.ts` "USD → SDG with a rate" (preview writes nothing; applied totals equal the preview), "transfers into the new base use their received leg; splits still sum exactly", "budgets convert…; trashed and pending rows too"; ui `phase4.test.tsx` "enter a rate, preview new totals, confirm"; e2e `j10-base-currency.yaml` |
| ❌ Missing rate for a currency in history → blocked until provided                          | node "a currency in history has no rate → blocked, nothing changes"; ui "missing rate → blocked with the currency named"                                                                                                                                                                                                                        |
| (extra) FX table: list, same-day replace, soft delete without touching history              | node `phase4.test.ts` "FX table"; ui "FX table UI"                                                                                                                                                                                                                                                                                              |
| (extra) Reports: 12-month trend, month-over-month, top payees, pending excluded             | node `phase4.test.ts` "reports read models"; ui "Reports UI" (incl. Arabic)                                                                                                                                                                                                                                                                     |

## J11 Reset data

| Path                                                                         | Tests                                                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| ✅ Offers backup first, requires typing RESET, wipes DB + attachments + keys | node `reset.test.ts` "wipes database, files and keys, in a safe order"; ui `phase2.test.tsx` J11; e2e `j11-reset.yaml`    |
| ❌ Cancel at any step → nothing changed                                      | node "anything else changes nothing", "keys are kept"; ui "cancel changes nothing", "a failed reset says nothing changed" |
