# ADR-010: App lock — Argon2id PIN in the Keychain, OS-invalidated biometric token

- Status: Accepted (Phase 2)
- Date: 2026-10-16

## Context

Spec 7 asks for a 4–6 digit PIN hashed with Argon2id, biometrics, auto-lock, escalating delays with **no wipe**, and safe forgot-PIN paths. J8 also requires that a biometric change at OS level (a new fingerprint or face) invalidates biometric unlock.

## Decision

- **PIN hash:** Argon2id via `@noble/hashes` (pure JS; Hermes has no WASM), 16-byte random salt. The parameters are stored with the hash.
  - Measured in Node `--jitless` (an interpreter proxy for Hermes): m=19 MiB/t=2 takes **≈ 8.9 s**, and m=1 MiB/t=2 takes **≈ 0.43 s**.
  - We use **m=1 MiB, t=2** for the PIN. This is below OWASP's 19 MiB. It is acceptable because the hash never leaves the device: it lives in Keychain/Keystore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
  - Online guessing is throttled by the cool-downs below. A 6-digit PIN can be brute-forced offline under _any_ KDF once the hash is extracted, so the storage location is the real protection, not the KDF cost.
  - A successful unlock re-hashes with newer parameters, so the cost can be raised later (e.g. a native Argon2 module in Phase 5) without breaking existing PINs.
- **Attempts:** 5 free attempts, then 30 s, 1 min, 5 min, 15 min, and 15 min for every failure after that. State is persisted in the secure store. A clock moved backwards re-anchors the penalty instead of shortening it. The lock never wipes data.
- **Fail closed:** a corrupt lock record keeps the app locked; it is never silently unlocked.
- **Biometrics:** enabling stores a random 32-byte token with `expo-secure-store` `requireAuthentication: true`. That item is biometric-gated, and the OS invalidates it on a biometric change (iOS `biometryCurrentSet`, Android key invalidation). Its SHA-256 is kept in the lock record.
  - Unlocking means reading the token. A null or mismatching token means "invalidated": biometric unlock is disabled and the PIN is required (J8).
  - Biometric unlock also clears an active PIN cool-down.
- **Forgot PIN:**
  - With biometrics: a biometric unlock grants a one-shot right to set a new PIN.
  - Without biometrics: the only path is **reset and restore from a backup**, stated plainly at PIN setup, in settings and on the lock screen, each time with a nudge to make a backup.
- **Auto-lock:** the app locks on cold start and when it returns from the background after `lockTimeoutSeconds` (default 60; 0 = immediately). Content is hidden from screen readers while locked.
- **App-switcher privacy:** a cover is rendered whenever the app is not `active`, so the OS snapshot shows no balances. `FLAG_SECURE` / screenshot blocking is not used (OPEN_QUESTIONS Q29).
- **Root/jailbreak:** `expo-device.isRootedExperimentalAsync()` (Android only). A warning banner in the security screen; never blocking.
