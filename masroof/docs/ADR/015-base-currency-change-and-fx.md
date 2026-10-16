# ADR-015: Manual FX table and explicit, previewed base-currency change

- Status: Accepted (Phase 4)
- Date: 2026-10-16

## Context

Spec 4 says base-currency totals use `base_amount_minor` frozen at entry time, and that "changing the base currency triggers an explicit, previewed recalculation — never a silent relabel" (gap G5). J10 has two paths:

- ✅ USD → SDG with a rate entered → preview of the new totals → confirm → historical base amounts recomputed; the original transaction currencies are untouched.
- ❌ A currency in the history has no rate → the change is blocked until rates are provided.

Rates are manual in v1 (`fx_rates.source = 'manual'`). Since Phase 1, the app records every rate the user typed, or that a transfer implied, as a convenience for prefilling.

## Decision

### FX table

- **Screen:** Settings → Exchange rates lists every live rate ("1 EUR = 1.0850 USD", with its date). Users can add, edit and delete them.
- **Storage:**
  - A rate is a decimal string with up to 12 integer and 12 fraction digits, parsed by `parseRate` and never stored as a float.
  - There is one rate per (base, quote, day). Saving the same pair and day again replaces it.
  - Lookups (`latest`) use the most recent rate on or before a date, reading either direction and inverting when needed (BigInt, half-even).
- **Deleting a rate:** a soft delete that is audited. Transactions keep their frozen `fx_rate_to_base`, so deleting a rate never changes history.

### Base-currency change (`repos.baseCurrency`)

1. **`requiredRates(newBase)`** lists every currency that needs a rate to `newBase`:
   - the currency of every transaction (posted, pending, void, and in Trash too, so nothing is left inconsistent), except transfers whose received leg is already in `newBase`, because that leg is used as-is;
   - the currency of every live budget that is not `newBase`.

   Each entry is prefilled from the FX table (direct or inverted) when a rate exists.

2. **`preview(newBase, rates)`** computes the change without writing anything:
   - **Blocking:** it refuses with `rates_missing` (listing the currencies) when any required rate is absent (J10 ❌).
   - **Totals:** this month's income, expense and spent-so-far, before and after, plus the number of transactions and budgets that will change.
3. **`apply(newBase, rates)`** runs the same computation in **one unit of work**. It is all or nothing, and it changes only these:
   - **Transactions:** for each transaction, `fx_rate_to_base` and `base_amount_minor` are recomputed with the same `computeBaseAmounts` used at entry, and split base amounts are re-allocated, so category totals still sum exactly. `amount_minor`, `currency` and the transfer legs are **never touched**.
   - **Budgets:** amounts are converted to the new base (half-even), and their currency becomes the new base.
   - **Rates:** the rates used are saved to the FX table, dated today.
   - **Settings:** `baseCurrency` is set.
   - **Audit:** one entry records the old base, the new base, the rates and the counts. There is no per-transaction before/after copy, because 73k rows would multiply the audit log for an operation the user can reproduce. The screen offers a backup first, just like Reset (OPEN_QUESTIONS Q42).

- **One rate per currency:** each currency uses a single rate, the one the user confirms in the preview. Per-date historical rates are not used. The result is predictable and is shown before it happens, and v1 has no rate history worth trusting (it is manual) (Q41).
- **Not affected:**
  - Account opening balances stay in the account's own currency.
  - Net worth converts accounts at display time, as before.
  - Goals keep their account's currency.
- **Switching back:** going from SDG back to USD needs rates again. Because of rounding, a round trip is not guaranteed to restore the exact previous cents. The copy says so, which is another reason for the backup prompt.

## Consequences

- A base change rewrites up to every transaction row in one transaction. Phase 5's 73k-row seed will measure it; the work is a single pass with prepared statements and no per-row audit.
- Because the preview and apply share one code path, tests can assert that what the user saw is exactly what was written.
