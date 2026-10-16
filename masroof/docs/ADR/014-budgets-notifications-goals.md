# ADR-014: Budgets, threshold alerts, local notifications and goals

- Status: Accepted (Phase 3)
- Date: 2026-10-16

## Context

Spec 5.7 asks for budgets with local notifications at thresholds and a "safe to spend today" figure. J6 adds these requirements:

| Path                                   | Requirement                                                            |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Food 400/month                         | Notify at 80%; the Home strip turns amber                              |
| Expense edited or deleted              | Recalculate; an alert already sent does not re-fire in the same period |
| Budget currency ≠ transaction currency | Convert using the stored base amounts                                  |
| Category merged or archived            | Migrate the budget, or prompt the user                                 |

J2 also requires that a budget alert fires when a quick add crosses a threshold. Spec 5.12 lists goal progress.

## Decision

### Budget evaluation (pure, `src/domain/planning/budget.ts`)

- **Spending** is the sum of `transaction_splits.base_amount_minor` across all of these:
  - posted, non-deleted **expense** transactions;
  - dated in the period and **on or before today**, so future-dated "Scheduled" expenses are excluded (as in J2);
  - for the category **and its sub-categories**. An overall budget (`category_id IS NULL`) covers every expense.

  Transfers never count. Scheduled expenses inside the period are reported separately and **reserved** when computing safe to spend.

- **Currency:** spending is always in the base currency, using base amounts frozen at entry (spec 4), so a USD coffee on a SDG budget counts at the rate it was recorded with. A budget whose own currency differs from the base is converted with the latest FX rate. If no rate exists, the status is `missing_rate` and **no alert fires**, because a wrong alert is worse than a late one.
- **Periods:**
  - `monthly` uses the calendar month.
  - `weekly` uses the user's first day of the week.
  - `custom` uses the inclusive `custom_start..custom_end`, does not repeat, and reports `ended` after it finishes.
- **Rollover** (opt-in): the period's limit is the amount plus the **signed** leftover of the immediately previous period. Underspend adds to the limit and overspend reduces it. The carry is not chained across many periods, so one bad month cannot cascade forever (OPEN_QUESTIONS Q36).
- **Thresholds:** integers 1–200, unique, ascending, at most 5, default `[50, 80, 100]`. A threshold is reached when `spent × 100 ≥ threshold × limit`. This uses BigInt, so 15-digit amounts never lose precision. A limit of 0 or less counts as every threshold reached.
- **Health tone:**
  - `ok` below 80%.
  - `warning` (amber) from 80%.
  - `over` (red) from 100%.

  The tone is shown with an icon and text as well as colour (spec 9).

- **Safe to spend today:** `floor((limit − spent − scheduled) / days left including today)`, never below 0, in base minor units. Flooring keeps the figure conservative. It is shown on Home for the overall monthly budget.

### Alerts

- **Evaluation:** `BudgetAlertService.evaluate()` runs after every transaction write (quick add, edit, delete and undo, confirm of a pending item, CSV import) and after each recurrence engine run. It only looks at the **current** period.
- **Recording:** each reached threshold is written once to `budget_alerts_sent (budget_id, period_start, threshold)`, which already exists from migration 1, with `INSERT OR IGNORE`.
  - Only thresholds newly inserted in this call notify, and a single notification names the highest of them.
  - So deleting an expense and then re-adding it **does not re-fire** (J6). A new period starts clean.
- **Delivery:** in-app delivery is always available. The Home strip and the budgets screen reflect state live, and a snackbar names the crossed threshold after a save. A local notification is sent in addition when permission is granted.

### Category merge and archive

- **Merge** (`categories.merge(source, target, resolution?)`):
  - **Checks:** the two categories must be the same kind, the target must not be archived, and the source must have no sub-categories unless the target is top-level.
  - **Splits:** live splits are moved to the target.
  - **Rule templates:** category ids in rule templates are rewritten.
  - **Budgets:** a source budget moves to the target when the target has none for that period. If the target has one, the call returns `budget_conflict` until the UI asks the user to **keep the target's** budget or **combine** the two (amounts are added, and the currencies must match).
  - **Result:** the source is archived (never hard-deleted, spec 5.14), and the whole merge is one unit of work.
- **Archive:** the budget stays and is flagged `category_archived` in the budgets screen, which prompts the user to move it to another category or delete it. Rules whose template uses the archived category stop with `last_error` (ADR-013) and are listed in Upcoming.

### Notifications (`expo-notifications`, local only)

- **Port:** `NotificationsPort` exposes `status`, `request`, `present`, `schedule` and `cancel`. The real implementation is in `services/notifications/expo-notifications.ts`; tests use a fake.
- **Permission request:** asked **in context**, the first time the user creates a recurring rule or a budget, never at launch.
  - When denied, a banner in Upcoming and Budgets explains that reminders are limited to the in-app inbox and links to the OS settings (J5).
  - Nothing else changes: the engine and the inbox do not depend on notifications.
- **Content:** no amounts, notes or balances, because notifications appear on the lock screen. The text names only the category or payee label and the event, for example "Food budget reached 80%" or "Rent is due today" (OPEN_QUESTIONS Q35).
- **Recurring reminders:** for each active rule, the next occurrence is scheduled at 09:00 local time with identifier `recurring:<ruleId>`. Rescheduling replaces it and deleting or pausing the rule cancels it. One notification per rule keeps the app well under iOS's 64-pending limit.
- **Android:** a `reminders` channel at default importance. `SCHEDULE_EXACT_ALARM` is not requested; inexact delivery is fine for a 09:00 reminder.

### Goals (`src/domain/planning/goal.ts`)

- **Data:** a goal is a name, a target in a currency, an optional target date and a **required** linked account. The schema allows null, but a goal with no link would have no progress source (OPEN_QUESTIONS Q37).
- **Progress:** the linked account's balance is converted to the goal currency (or `missing_rate`). From that the screen shows progress (clamped 0–100% for display, exact amounts shown), remaining amount, and the monthly amount needed, rounded **up** so following it reaches the target.
- **Status:** `reached`, `overdue` (date passed, not reached), `active` or `no_date`.

## Consequences

- A budget needs no stored "spent" column. Everything is computed from the ledger, so edits, deletes, undo, restore and CSV import are reflected automatically and can never drift.
- Alert history stays in `budget_alerts_sent`. It is included in backups (already allow-listed), so restoring a backup does not replay old alerts.
