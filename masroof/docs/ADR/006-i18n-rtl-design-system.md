# ADR-006: i18n, RTL and design tokens

- Status: Accepted (Phase 0)
- Date: 2026-10-15

## Decision

- **i18next 26 + react-i18next 17.** Resources are bundled and initialised synchronously (`initAsync: false`), so there is no flash of untranslated keys. Keys are typed via `CustomTypeOptions`. Tests check that Arabic has exactly the English keys, the same `{{placeholders}}`, and no untranslated copies.
- **Direction:** `I18nManager.allowRTL/forceRTL` plus `reloadAppAsync()` from `expo`, because React Native fixes direction at startup. The app never reloads by itself on boot, which rules out reload loops on platforms that ignore `forceRTL`. The user is prompted after changing language. `expo-localization` has `supportsRTL: true` (Android `supportsRtl="true"` confirmed via prebuild).
- **Logical layout only:** ESLint bans `left/right/marginLeft/paddingRight/...` and `textAlign: 'left'|'right'` in `app/`, `src/ui/` and `src/features/`. The primitives (`Row`, `Stack`, `Screen`, `Card`) rely on RN's automatic `row` mirroring.
- **Digits:** Eastern Arabic numerals are a user setting (`numerals: 'arab'`) applied by `formatMoney`, independent of locale. Input accepts either digit set.
- **Tokens** (`src/ui/tokens.ts`): light and dark palettes. Every foreground/background pair in use is listed in `CONTRAST_PAIRS`, and a test enforces WCAG AA ≥ 4.5:1 in both schemes. Income and expense keep the baseline's green and red, but `AmountText` always adds a sign and an arrow glyph, and gives screen readers a sentence ("Expense 12.50 USD").
- **Accessibility defaults:** font scaling is always on, touch targets are at least 48pt, error messages use `accessibilityRole="alert"`, and choices are radio groups with a checked state.
