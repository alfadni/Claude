# ADR-017: Privacy posture — no network by default, opt-in scrubbed crash reports

- Status: Accepted (Phase 5)
- Date: 2026-10-16

## Context

The spec says the app works fully offline and needs no network permission in v1, except for opt-in crash reporting through Sentry, with PII scrubbing on (G12, Q5, Q11).

The app holds personal financial data: amounts, notes, payees, account names and receipt photos. A crash report built the usual way can leak exactly that through these fields:

- the exception message (an SQL error quoting a value, or a validation message);
- breadcrumbs (UI text, navigation params);
- `extra` and `contexts`, device identifiers, screenshots and view hierarchies.

## Decision

### No network unless crash reporting is built in and turned on

- **Build-time switch:** crash reporting exists in a build only when `EXPO_PUBLIC_SENTRY_DSN` is set when the app is bundled. Without it, the toggle is hidden and Sentry is never imported.
- **Android `INTERNET` permission:** removed from release builds by a config plugin (`plugins/with-release-permissions.js`) whenever `MASROOF_RELEASE=1` and no DSN is configured.
  - Dev builds keep the permission, because Metro needs it.
  - iOS has no network permission to remove. The app makes no requests: nothing in v1 calls `fetch`, and notifications are local only.
- **Default off:** the user setting `crashReports` defaults to off, and it is never turned on by onboarding or by a restore. Restore keeps the setting from the backup, which can only have been turned on by the user.

### What a crash report may contain (`src/services/crash/scrub.ts`, pure and unit-tested)

The scrubber builds a **new event from an allow-list**. It never removes fields from the original, so a field added by a future SDK version is dropped by default. It keeps only these:

- event id, timestamp, level, platform, release, environment;
- for each exception:
  - the `type` (for example `TypeError`) and the mechanism type;
  - stack frames reduced to the file **basename**, function name, line, column and `in_app`.
- the OS name and version.

Everything else is dropped:

- **Messages:** the exception `value` (message text) is replaced by its type, and `message` and `logentry` are removed.
- **Context:** `extra`, `contexts` (other than OS), `tags`, `user`, `request`, `breadcrumbs`, `modules`, `debug_meta` and `sdk` details.
- **Captures:** screenshots and view-hierarchy attachments.

**SDK options:**

- `sendDefaultPii: false`
- `maxBreadcrumbs: 0` and `beforeBreadcrumb: () => null`
- `attachScreenshot: false` and `attachViewHierarchy: false`
- `enableAutoSessionTracking: false`
- `tracesSampleRate: 0` (no performance tracing)
- `beforeSend: scrubEvent`

Native crash handling stays on, because native crashes are what the feature is for.

### Code layout

- **Interface:** a `CrashReporter` port with `start()`, `stop()` and `capture()`.
- **Sentry adapter:** loads `@sentry/react-native` with a dynamic `import()` only when the reporter starts.
- **Lifecycle:**
  - The app starts the reporter at boot when the setting is on.
  - Turning the setting off calls `Sentry.close()` straight away.
  - Turning it on starts the reporter.

## Consequences

- Reports are less useful for debugging, because there are no messages or breadcrumbs. Stack traces and the release are enough to find where something crashed, and that is the trade-off a finance app should make.
- Store privacy labels can say "data not collected" for builds without a DSN. For builds with one, they say "crash data, optional, not linked to identity" (`store/data-safety.md`).
