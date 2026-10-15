# ADR-003: Money as integer minor units with an in-house Money module

- Status: Accepted (Phase 0)
- Date: 2026-10-15

## Context

The spec requires integer minor units and suggests `currency.js` or `dinero.js`. On top of that we need:

- ISO 4217 exponents (JPY 0, KWD/BHD 3, CLF 4). These must not come from `Intl`: CLDR differs from ISO, e.g. IQD.
- Parsing Eastern Arabic and Persian digits and the Arabic separators (U+066B/U+066C).
- Deterministic formatting that doesn't depend on Hermes' `Intl` (numbering-system support varies by build).
- FX conversion with up to 12 fractional rate digits and no float step.

## Decision

`src/domain/money/` (zero dependencies, 100% line coverage):

- `Money = { amountMinor: number; currency: CurrencyCode }`. JS numbers are exact up to 2^53−1 (≈ 9.007e15). User input is capped at 15 digits (< 1e15), per J2. All arithmetic checks `Number.isSafeInteger` and throws rather than losing precision.
- Parsing is string-based (`parseAmount`). There is no `parseFloat` anywhere: an ESLint rule bans `parseFloat` and `.toFixed`.
- FX rates are decimal **strings** (`DecimalRate`). `convert` and `deriveRate` run in BigInt with **half-even rounding**. `deriveRate` supports J4: the user types both legs and the rate is derived.
- `allocate` (largest remainder) splits amounts without gaining or losing a minor unit. A property test covers 500 random cases.
- `formatMoney` applies the user's separators and digit shapes itself.

## Consequences

- No third-party money dependency to audit or upgrade. The module is ~400 lines with exhaustive tests.
- If a total ever needs more than 2^53 minor units, `checked()` throws loudly. That needs ~9 quadrillion USD cents, which no personal ledger will reach.
