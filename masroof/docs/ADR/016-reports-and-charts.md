# ADR-016: Reports and charts — native View-based charts, no chart library in v1

- Status: Accepted (Phase 4)
- Date: 2026-10-16

## Context

Spec 5.12 (G11) asks for these reports: category breakdown (as in the baseline app), a trend by month, a month-over-month change per category, income vs expense, top payees, and goal progress. The spec's stack section names two chart libraries and asks for an ADR to choose: `victory-native` (Skia) or `react-native-gifted-charts`.

Every chart we need is a bar or column of totals:

| Report             | Shape                                        |
| ------------------ | -------------------------------------------- |
| Category breakdown | Horizontal bars, % and amount (baseline)     |
| Trend by month     | 12 columns (income and expense side by side) |
| Income vs expense  | Two bars and a net figure                    |
| Month-over-month   | A list of rows with a signed delta           |
| Top payees         | Ranked bars                                  |
| Goals              | Progress bars (already built in Phase 3)     |

## Options

| Criterion                 | victory-native (Skia)                         | gifted-charts (SVG)                     | Plain `View` bars                             |
| ------------------------- | --------------------------------------------- | --------------------------------------- | --------------------------------------------- |
| Native dependencies       | `@shopify/react-native-skia` (≈ 6 MB per ABI) | `react-native-svg`, linear-gradient     | none                                          |
| Screen reader             | One canvas; values need a separate a11y layer | SVG nodes are not accessible by default | Each bar is an element with a spoken label    |
| RTL                       | Manual axis mirroring                         | Manual                                  | Automatic (flex direction follows the layout) |
| Dynamic Type at 200%      | Canvas text does not scale                    | Partly                                  | Native `Text` scales                          |
| Testable in Jest          | Needs Skia mocks                              | Needs SVG mocks                         | Rendered and asserted like any screen         |
| Line, area or zoom charts | Yes                                           | Yes                                     | No                                            |

## Decision

- **v1 draws charts with plain `View`s.** The decisive points are the spec's accessibility requirements (screen-reader labels on all controls, amounts read as currency, 200% text), RTL mirroring, and staying offline with no extra native code. Library charts would need extra work in each of those areas to reach the same level.
- **"Trend line" becomes columns:** the trend by month is drawn as columns, one pair (income ▲ / expense ▼) per month, rather than a line. The same totals can be read aloud bar by bar, which a line chart cannot offer without extra work (OPEN_QUESTIONS Q43).
- **Building blocks** (`src/ui/components/charts.tsx`):
  - `HBar` is a labelled horizontal bar.
  - `ColumnChart` draws grouped columns with an accessible label per group.

  Both take an already-formatted label from the caller, so the UI layer does no money maths.

- **Revisiting:** if a later version needs line or area charts with interaction (zooming, scrubbing), `react-native-gifted-charts` is the first candidate. It needs `react-native-svg` only, and its SVG can carry accessibility props.

### Read models (`reports-repository`)

- `monthlyTotals(lastMonth, count)`: income and expense per calendar month for the last `count` months, using the posted base amounts of each month.
- `categoryComparison(period, kind)`: each category's total in this period and the previous one, with the signed delta. A category that appears or disappears in one of them shows up as 0 on that side.
- `topPayees(period, limit)`: expense totals by payee, then count, then name.

All of them follow the existing read-model rules: base amounts only, `status = 'posted'`, nothing deleted, transfers excluded, and spending dated on or before today (scheduled items are not counted as spent).

## Consequences

- Nothing native is added. Charts are plain components covered by UI tests, including Arabic and Eastern Arabic digits.
- The visuals are simpler than a charting library's. That is acceptable for v1; the data layer would not change if a library replaces the drawing later.
