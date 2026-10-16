# ADR-013: Recurrence engine — own RRULE subset, clamped month ends, idempotent backfill

- Status: Accepted (Phase 3)
- Date: 2026-10-16

## Context

Spec 5.8 and J5 ask for recurring transactions in three modes (`auto_post`, `remind_only`, `confirm_before_post`). The engine runs when the app opens and from background fetch, and it must be idempotent. J5 also lists these failure paths:

| Path                        | Requirement                                                   |
| --------------------------- | ------------------------------------------------------------- |
| App not opened for 3 months | Back-fill every missed occurrence exactly once; review if > 3 |
| Rule on the 31st            | Months without a 31st post on the last day                    |
| Clock moved backwards       | No duplicates, no deletions                                   |
| Notifications denied        | The in-app inbox still works                                  |

The spec suggests the `rrule` npm package. We evaluated it and do not use it:

- **RFC 5545 skips invalid dates:** `FREQ=MONTHLY;BYMONTHDAY=31` produces nothing in February, April and other short months. J5 explicitly needs the opposite (clamp to the last day). Getting that out of RRULE needs `BYMONTHDAY=28,29,30,31;BYSETPOS=-1`, which users cannot read and which breaks for rules on the 29th or 30th.
- **Time handling:** `rrule` works on JS `Date` instants, with "floating" UTC dates and an optional `tzid` that relies on `Intl` or Luxon. Our ledger is built on `LocalDate` (ADR-004). An instant-based expander reintroduces exactly the DST and day-shift bugs that ADR-004 removes.
- **Size:** the app needs four frequencies, an interval, weekdays and a day of month. The rest of RFC 5545 (BYSETPOS, BYWEEKNO, hourly rules, EXDATE) is unused weight.

## Decision

- **Storage:** `recurring_rules.rrule` stores an **RFC 5545-syntax subset**, so a future switch to a full library (or to sync) still reads it.
  - `FREQ` is `DAILY`, `WEEKLY`, `MONTHLY` or `YEARLY`. `INTERVAL` is 1–99.
  - `BYDAY` lists weekdays and is allowed only with `FREQ=WEEKLY`.
  - `BYMONTHDAY` is 1–31, or `-1` for the last day, and is allowed only with `FREQ=MONTHLY`.
  - Start, end and count live in their own columns (`starts_on`, `ends_on` inclusive, `max_occurrences`), so they are never duplicated in the string. `DTSTART`, `UNTIL`, `COUNT` and any other part are rejected by the parser.
- **Semantics** (pure domain, `src/domain/planning/recurrence.ts`):
  - **Anchored, not chained:** occurrence _n_ is computed from the anchor (`starts_on`) each time, so Jan 31 → Feb 28 → **Mar 31**, never Mar 28 (no drift).
  - **Month-day clamp (documented deviation from RFC 5545):** a day missing from a month clamps to that month's last day. A yearly Feb 29 rule posts on Feb 28 in common years.
  - **Weekly:** `WKST=MO`. The days in `BYDAY` repeat every _interval_ weeks, counted from the week containing `starts_on`.
  - **Bounds:** occurrences before `starts_on`, after `ends_on`, or beyond `max_occurrences` are never produced.
- **Cursor:** migration 3 adds three columns to `recurring_rules`:
  - `next_occurrence_on`: the first occurrence not yet generated.
  - `occurrence_count`: how many have been generated, for `max_occurrences`.
  - `last_error`: why the rule could not post.

  The cursor only moves forward. If the device clock is moved backwards, today is earlier than the cursor, so nothing is due. Nothing is regenerated and nothing is deleted.

- **Idempotency key:** each generated transaction carries `recurrence_key = "<rule_id>:<occurrence date>"`, which is `UNIQUE` across all rows, including soft-deleted ones. This holds even if two runs race: foreground and background, two connections, or a cursor that failed to save. A key that already exists is skipped. A generated transaction that the user deletes is **not** recreated.
- **Engine run** (`src/services/planning/recurrence-engine.ts`), for each active rule:
  1. It collects occurrences from the cursor up to today, at most 1,000 per rule per run.
  2. It writes them in **one unit of work per rule**: the rows, the advanced cursor and `last_run_at` commit together, or not at all.
  3. **Statuses:**
     - `auto_post` writes `posted` rows when 1–3 occurrences are due.
     - When **more than 3** are due at once, it writes `pending_recurring` rows. The user then gets a review with "Post all" or item-by-item confirmation, rather than a silent injection of a dozen transactions (J5).
     - `confirm_before_post` and `remind_only` always write `pending_recurring` rows, which appear in the **Upcoming** inbox.
     - Confirming sets `posted`; skipping sets `void`, which keeps the key so the occurrence never comes back.
  4. **Validation:** the template is validated like any user entry. If the account or category was archived, or a foreign currency has no FX rate, the engine writes **nothing** for that rule. It stores `last_error` and leaves the cursor where it is, so once the user fixes the rule the missed occurrences are back-filled.
- **Pending rows:** `pending_recurring` and `void` rows are excluded from balances, reports, the transactions list, CSV export and duplicate detection. Every read model filters on `status = 'posted'`.
- **Time of day:** a generated transaction gets noon on its occurrence date in the rule's IANA zone (`recurring_rules.tz`), the same convention as Q19, so the calendar day never shifts.
- **Creating a rule:** rules are created from an existing transaction ("Repeat…"). That transaction becomes occurrence #1: it is linked to the rule, given its key, and the cursor starts after it. So "rent this month" is never recorded twice.
- **Edits:**
  - "This and future" (J7) updates the template.
  - Changing the schedule keeps the anchor (`starts_on`) and moves the cursor to the first new-schedule date after the last generated occurrence. Already generated rows are never touched.
  - Pausing stops generation. Resuming continues from today; occurrences that fell inside the pause are not back-filled.
  - Deleting a rule soft-deletes the rule and voids its still-pending occurrences. Posted transactions remain and keep their link (the FK is kept for audit).
- **When it runs:**
  - At boot after migrations.
  - When the app returns to the foreground on a new day.
  - From `expo-background-task` (iOS BGTaskScheduler, Android WorkManager; minimum interval 12 h).

  The background task opens the encrypted DB itself. While the device is locked, the Keychain item (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) is unreadable, so the task exits without doing anything and the next app open catches up. That trade-off is accepted (OPEN_QUESTIONS Q34).

## Consequences

- Rules created by other RRULE tools are not importable unless they fit the subset. v1 has no import path for rules, so nothing is lost.
- A rule cannot generate more than 1,000 rows per run. A daily rule left unopened for more than 2.7 years catches up over several opens.
- Tests cover month-end clamping across leap years, anchoring without drift, weekly intervals with multiple weekdays, end-date and count limits, idempotency under a re-run, a racing second connection and a clock moved backwards, and the review threshold for more than 3 items.
