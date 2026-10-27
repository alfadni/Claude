# ADR-004: Time model — UTC instant + IANA zone + derived local date

- Status: Accepted (Phase 0)
- Date: 2026-10-15

## Decision

- Each transaction stores `occurred_at` (UTC epoch ms), `occurred_tz` (IANA zone at entry) and `occurred_on` (the `YYYY-MM-DD` local date in that zone, computed at write time).
- Calendar views, budgets and reports filter on `occurred_on` with string comparisons, using an index. A purchase at 23:30 in Khartoum stays on that day after the user flies to Dubai (spec §6), and DST changes never move a transaction to another day.
- `LocalDate` is a branded string. Day and month arithmetic runs in UTC epoch days. `addMonths` clamps to the last day of the month, which J5's "rule on the 31st" needs.
- `Period` is half-open `[start, end)`, so adjacent periods tile without double counting. Week periods honour the user's first day of the week (Saturday is common in Sudan and the Gulf).
- Zone conversions use `Intl.DateTimeFormat#formatToParts` with no library. `startOfDayInZone` handles zones where midnight is skipped (tests cover America/Santiago and Asia/Beirut).
- `date-fns` / `rrule` will be added when the recurrence engine needs them (Phase 3). Nothing in Phase 0 required them.
