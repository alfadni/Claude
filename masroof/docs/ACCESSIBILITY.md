# Accessibility audit (Phase 5)

Spec 5.15 and section 9 ask for these:

- Dynamic Type;
- screen-reader labels on every control, with amounts read as currency;
- 4.5:1 contrast;
- mirrored layouts in Arabic, and optional Eastern Arabic numerals;
- colour never as the only signal.

## Automated (runs in CI)

| Check                                                                    | How                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every interactive element has a role **and** a non-empty accessible name | `tests/ui/a11y.test.tsx` renders **27 screen states** (all 26 screens, plus quick add in edit mode) with a populated ledger, in **English and Arabic** (54 renders), and walks the host tree |
| Every text input has a label; every image has a label                    | same                                                                                                                                                                                         |
| No text opts out of Dynamic Type (`allowFontScaling={false}`)            | same, and `Text` always sets `allowFontScaling`                                                                                                                                              |
| The audit really detects violations                                      | A self-test renders a deliberately bad tree and expects all five problem kinds to be reported                                                                                                |
| Contrast ≥ 4.5:1 for every text/background token pair, light and dark    | `tests/node/ui/tokens.test.ts` (WCAG relative luminance)                                                                                                                                     |
| Logical properties only (no left/right)                                  | ESLint rule on `app/`, `src/ui`, `src/features`                                                                                                                                              |
| Amounts read as currency with type (income/expense/transfer)             | `AmountText` spoken labels; Home day cells, reports bars and budget bars carry full sentences                                                                                                |
| Colour never the only signal                                             | ▲ / ▼ markers, ✓ / ⚠ / ⛔ budget tones, "+/−" signs; tests assert on the text, not the colour                                                                                                |
| RTL                                                                      | i18n tests, Arabic renders of every screen in the audit; chevrons swap in RTL                                                                                                                |

## Manual checks still needed on devices

- [ ] VoiceOver (iOS) and TalkBack (Android): focus order on Home, Quick add and Lock. In particular, the PIN pad must not announce digits.
- [ ] 200% text (iOS Larger Text and Android font scale 2.0): Home strip, quick-add keypad, reports columns.
- [ ] Switch Control / keyboard navigation on Android.
- [ ] Reduce Motion: nothing in v1 animates beyond the platform defaults.

## Known limitations

- The trend chart's month axis shows month numbers. The full month name is in each column's spoken label (ADR-016).
- The Arabic copy needs a native-speaker review (OPEN_QUESTIONS Q8).
