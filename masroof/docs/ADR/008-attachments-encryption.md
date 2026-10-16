# ADR-008: Receipt photos — app-level AES-256-GCM, derived key, crash-safe writes

- Status: Accepted (Phase 1)
- Date: 2026-10-16

## Context

Spec section 2 says attachments are "stored in app sandbox, encrypted at rest". OS file protection (iOS Data Protection, Android FBE) covers a locked, stolen phone. It does not protect files included in device backups or copied off by tooling, and SQLCipher only covers the database file.

## Decision

- **Cipher:** AES-256-GCM using `@noble/ciphers` 2.4.0 (pure JS, audited, no WASM, so it runs on Hermes). Envelope: `[0x01 version][12-byte random nonce][ciphertext+tag]`. The attachment id is the **associated data**, so swapping one encrypted file for another fails authentication.
- **Key:** HKDF-SHA256 sub-key (`masroof/attachments/v1`) derived from the DB key inside `openEncryptedDatabase`. This adds no second key to lose, and the raw DB key never leaves that module. Losing the DB key already means restore-from-backup (ADR-001); attachments follow the same lifecycle.
- **Integrity:** the SHA-256 of the plaintext is stored in the row and checked after decryption.
- **Pipeline:** pick image → resize to ≤ 1600px on the longest edge (never upscaled), JPEG q0.7 → read bytes → **delete the picker's and the manipulator's plaintext cache files** → encrypt → write `<id>.bin.tmp` → rename → insert the DB row.
- **Failure handling (J2):** if free space is under 2 × the file size + 2 MB, the result is `storage_full` before anything is written. A write or rename error deletes the partial files. If the DB rejects the row (the 5-file limit, or the transaction was deleted), the file is deleted. The transaction itself is never rolled back for a photo failure, and the UI offers **Retry**.
- **Orphan sweep** on every launch: `.tmp` files and files with no DB row are deleted. Files of soft-deleted (Trash) rows are kept until the purge after 30 days.
- **Display:** images are decrypted in memory into a `data:` URI and never written back to disk in clear.

## Consequences

- Each photo costs one AES-GCM pass in JS (≈ 300 KB after compression). That is acceptable for ≤ 5 photos per transaction. Revisit with a native crypto module if the Phase 5 profiling shows jank.
- Backups (Phase 2) will re-encrypt attachments under the backup passphrase key.
