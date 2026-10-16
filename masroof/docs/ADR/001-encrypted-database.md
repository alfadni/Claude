# ADR-001: Encrypted local database — expo-sqlite + SQLCipher

- Status: Accepted (Phase 0); to be re-checked against the Phase 5 performance budget
- Date: 2026-10-15

## Context

All data is local (spec §2, §6). It must be encrypted at rest (G7, §7) and support 73k+ transactions at 60 fps. The candidates were `op-sqlite` + SQLCipher and `expo-sqlite` + SQLCipher. Both have a Drizzle driver.

## Decision

Use **expo-sqlite** (`~58.0.13`) with its config plugin option `useSQLCipher: true` (checked in `plugin/build/withSQLite.js`, and with `expo prebuild`, which writes `expo.sqlite.useSQLCipher=true` to `gradle.properties`).

Reasons:

1. It is a first-party Expo module, versioned with the SDK, so there is no extra native-compatibility matrix to track.
2. Drizzle's `expo-sqlite` driver is synchronous (`BaseSQLiteDatabase<'sync'>`), the same mode as `better-sqlite3`. One repository codebase therefore runs on device and in Node tests against a real SQLite engine (ADR-008).
3. The performance target is met by data design rather than driver speed: partial indexes on `occurred_on`, `(account_id, occurred_on)` and `category_id`, plus pagination. op-sqlite stays the fallback if the Phase 5 benchmark (73k rows) misses the budget. The SQL layer is behind `SqlExecutor`, so a swap stays contained.

### Key management (`src/services/db/open-database.ts`)

- The key is 256 random bits from `expo-crypto.getRandomBytes`, applied as a raw key: `PRAGMA key = "x'…'"`. This skips PBKDF2, which is pointless for a key that is already random.
- It is stored with `expo-secure-store` using `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so it never syncs to iCloud Keychain or Google backup. Android `allowBackup=false`.
- On first launch the key is persisted and read back **before** anything is written, so data can never exist under a key we failed to keep.
- `PRAGMA cipher_version` must return a value. If it doesn't (for example in Expo Go), the app refuses to store anything (`cipher_unavailable`) instead of silently falling back to plaintext.
- Unexpected states are surfaced to the user, never "fixed" by deleting data: `key_lost` (encrypted DB with no key, e.g. a restored phone), `undecryptable`, `secure_store_failed`, `newer_schema`. Recovery (restore or explicit reset) comes in Phase 2.
- The key is validated as 64 hex characters before it is put into the PRAGMA, which blocks SQL injection through a tampered keystore entry.

## Consequences

- Expo Go is not supported. Development needs a dev build (`expo run:ios|android`).
- Attachment files need their own encryption (Phase 1/2). SQLCipher covers only the DB file.
