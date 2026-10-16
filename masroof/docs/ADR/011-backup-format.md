# ADR-011: Encrypted backup container (`.masroof`, format 1)

- Status: Accepted (Phase 2)
- Date: 2026-10-16

## Decision

- **Key:** Argon2id from the user's passphrase (minimum 10 characters). Parameters: **m=19 MiB, t=2, p=1**, the OWASP minimum, because backups leave the device. Parameters and a random salt sit in the plaintext header, so they can be raised in later versions. Header KDF values are range-checked, so a crafted file can't hang the phone.
- **Layout:** `"MSRFBK" 00 01 | u32 header length | header JSON | frames…`. Each frame is `u32 length | AES-256-GCM(nonce ‖ ciphertext ‖ tag)`, and its associated data is `sha256(header):frameIndex`. This detects:
  - **Header edits:** counts, schema version and the like.
  - **Dropped, duplicated or reordered frames.**
  - **Truncation:** the final `end` frame records the frame count.
  - **Trailing data.**
- **Frames:** `hello` (fixed text: a failure here means _wrong passphrase_, any later failure means _damaged file_), one `db` frame (JSON `{columns, rows}` per table), one frame per attachment (re-encrypted under the backup key), and `end`.
- **Restore is verify-then-write:**
  1. **Inspect** the header without the passphrase. A newer schema is refused with "update the app".
  2. **Decrypt every frame.** Check the row counts against the header, the attachment SHA-256 checksums, the scalar types, the table names (allow-list) and the attachment ids (UUID pattern).
  3. **Older schema:** load the rows into an in-memory scratch DB migrated to the backup's version, then run the remaining migrations. Old backups therefore go through the same migration code as the live DB (fixture: `tests/fixtures/backup-schema-v1.masroof`).
  4. **Existing data:** if the phone already has data, explicit confirmation is required, and a **safety backup** (same passphrase) is written to `backups/` first. If that write fails, nothing is replaced.
  5. **Attachments** are staged re-encrypted under this phone's key. **Paths are rebuilt locally** (`attachments/<id>.bin`); paths in the file are ignored, which blocks path traversal.
  6. **One transaction** deletes and re-inserts all rows, using only columns that really exist (no SQL from the file). Row counts and `foreign_key_check` are verified inside the transaction. Any failure rolls back and deletes the staged files.
- **Not included:** the app-lock PIN and biometric token (device secrets) and `drafts`. Settings and the audit log are included.

## Consequences

- The whole file is held in memory during create and restore. That is fine for typical ledgers (photos are ≤ 1600px JPEGs), but very large photo libraries may need streaming in a later phase (Q25).
- Argon2id runs on the JS thread for a few seconds; the UI shows a progress state first (Q32).
