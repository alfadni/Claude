# Privacy labels (App Store) and Data safety (Google Play)

## Builds without a crash-reporting DSN (default)

- **Apple App Privacy:** "Data Not Collected".
- **Google Play Data safety:**
  - No data collected and no data shared.
  - Encryption in transit: not applicable (no data is transmitted).
  - Users can request data deletion: data exists only on the device (Settings → Reset all data).

## Builds with crash reporting (`EXPO_PUBLIC_SENTRY_DSN` set)

The user must opt in (ADR-017).

- **Apple:**
  - Data Used to Track You: none.
  - Data Not Linked to You: **Diagnostics → Crash Data**.
  - Purpose: App Functionality.
- **Google Play:**
  - Collected: **App info and performance → Crash logs**. Optional, not shared, encrypted in transit, not linked to identity.
  - Purpose: App functionality / analytics (crash diagnosis).

The payload is limited to error type, stack frames (file basename, function, line), release and OS version. See `src/services/crash/scrub.ts` and its tests.
