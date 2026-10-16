# Masroof privacy policy

_Last updated: 16 October 2026 · Draft for store submission. Have it reviewed before publishing (OPEN_QUESTIONS Q48)._

**Short version:** your financial data stays on your phone. We cannot see it, we do not collect it, and the app does not connect to the internet.

## What the app stores, and where

- **What:** transactions, accounts, categories, budgets, goals, notes, payees, tags and receipt photos.
- **Where:** stored **only on your device**, in a database encrypted with SQLCipher (AES-256). The encryption key is held in the iOS Keychain or Android Keystore and never leaves the device.
- **Photos** are encrypted separately (AES-256-GCM).
- **No account and no cloud:** there is no account, no sign-in, no cloud sync, no analytics and no advertising.

## Network

- Release builds of Masroof do not make network requests. On Android, the internet permission is removed from release builds.
- Reminders and budget alerts are local notifications created on your phone. They never show amounts or notes on the lock screen.

## Optional crash reports

- Crash reporting is **off by default** and only exists in builds that include it.
- **What is sent:** if you turn it on (Settings → Privacy), a crash sends only the technical location of the error: file name, function, line, app version and OS version.
- **What is never sent:** amounts, notes, names, payees, accounts, screenshots, device identifiers, IP-derived user identities or usage breadcrumbs.
- **Processor:** reports go to our crash-reporting processor (Sentry).
- **Turning it off:** takes effect immediately.

## Backups and exports

- **Encrypted backups** (`.masroof` files) are encrypted with a passphrase only you know. You choose where to save or share them.
- **CSV exports** are plain text. The app warns you before you share one.

## Deleting your data

Settings → Reset all data erases the database, photos and keys from your phone. Uninstalling the app also removes them. We hold no copy, so there is nothing for us to delete.

## Children

Masroof is not directed at children under 13.

## Contact

Questions about this policy: privacy@masroof.app _(placeholder; replace before publishing)_.
