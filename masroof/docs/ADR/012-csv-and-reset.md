# ADR-012: CSV export/import and reset

- Status: Accepted (Phase 2)
- Date: 2026-10-16

## CSV

- **RFC 4180 throughout:** quotes, embedded commas, quotes and newlines, CRLF/LF, and a UTF-8 BOM.
- **Export:** one row per split, so splits re-import exactly. Transfers carry both legs. Amounts are written as locale-free decimals.
  - **Formula injection** (OWASP): text cells starting with `= + - @ \t \r` are prefixed with `'`, and the prefix is removed again on re-import.
  - **Plain-text warning:** the UI states that the file is not encrypted before sharing, and the temporary copy is deleted after the share sheet closes.
- **Import:** parse, then preview, then map, then commit.
  - **Headers:** English and Arabic synonyms are accepted. Our own export format is detected and grouped by `transaction_id`.
  - **Dates:** ISO, or `dmy`/`mdy` as chosen by the user.
  - **Type:** an explicit type column, or the amount's sign when there is none.
  - **Row-level errors:** date, amount, type, account, currency mismatch, unmapped category, splits that don't add up.
  - **Unknown categories:** mapped by the user to an existing category or created.
  - **Duplicates:** same account, date, type, amount and note, either already in the ledger or repeated in the file. They are shown and skipped.
  - **Commit:** nothing is written before commit. The commit is a single unit of work, so a rejected row rolls back everything, including categories created during the import.

## Reset (J11)

- The user must type `RESET` exactly (Q26). A backup is offered first, and Cancel at any point changes nothing.
- **Order:** close the DB, delete the DB file, delete app files (attachments, safety backups), delete the DB key, then wipe the lock secrets.
- If the DB file can't be deleted, **the keys are kept**. Deleting the key first would leave an undecryptable DB behind.
- The same flow is reachable from the lock screen (forgot PIN, no biometrics) and from the "key lost" boot error, where no database is open.
