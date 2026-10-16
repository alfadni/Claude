import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { createRepositories } from '@/data/repositories';
import { schema } from '@/data/schema';
import type { AppDatabase } from '@/data/database';
import { MIGRATIONS, SCHEMA_VERSION, migrate } from '@/data/migrations';
import { integrityReport } from '@/data/integrity';
import { createIdFactory } from '@/domain';
import { encodeBackup, FrameType, readHeader } from '@/services/backup/container';
import { deriveFromSecret } from '@/services/crypto/kdf';
import { bytesToHex } from '@/services/crypto/aead';

import { createLedger, must, type Ledger } from '../../helpers/ledger';
import { createDevice, fingerprint } from '../../helpers/backup';
import { rnd, TEST_KDF } from '../../helpers/security';
import { betterSqliteExecutor, seededBytes } from '../../helpers/sqlite';

const PASS = 'correct horse battery';

async function populated() {
  const phone = createDevice();
  const l = phone.ledger;
  const { id } = must(
    l.repos.transactions.create(
      l.expense({
        amountMinor: 12300,
        note: 'Eid clothes',
        payeeName: 'Souq',
        tagNames: ['eid'],
        splits: [
          { categoryId: l.ids.clothes, amountMinor: 8000 },
          { categoryId: l.ids.kids, amountMinor: 4300 },
        ],
      }),
    ),
  );
  l.tick();
  must(l.repos.transactions.create(l.transfer()));
  l.repos.settings.set('locale', 'ar');
  expect((await phone.attachments.add(id, 'receipt-1')).status).toBe('ok');
  expect((await phone.attachments.add(id, 'receipt-2')).status).toBe('ok');
  return { phone, txId: id };
}

function emptyPhone(): ReturnType<typeof createDevice> {
  const t = createLedger();
  // A brand-new install: no accounts, no transactions.
  t.sql.exec(
    'DELETE FROM transaction_splits; DELETE FROM transactions; DELETE FROM accounts; DELETE FROM categories; DELETE FROM audit_log; DELETE FROM settings;',
  );
  return createDevice(t);
}

describe('J9 backup → restore on a new phone', () => {
  it('restores identical data and attachments (row counts + checksums)', async () => {
    const { phone, txId } = await populated();
    const file = must(await phone.backup.create(PASS));

    const newPhone = emptyPhone();
    const preview = must(newPhone.backup.inspect(file));
    expect(preview).toMatchObject({ schemaVersion: SCHEMA_VERSION, attachments: 2 });
    expect(preview.counts.transactions).toBe(2);

    const opened = must(newPhone.backup.open(file, PASS));
    expect(must(await newPhone.backup.restore(opened, { confirmReplace: false }))).toEqual({
      safetyBackupPath: null,
    });

    expect(fingerprint(newPhone.ledger)).toEqual(fingerprint(phone.ledger));
    expect(integrityReport(newPhone.ledger.sql).ok).toBe(true);
    // Attachments decrypt on the new phone with ITS key and match the originals.
    const [a1, a2] = newPhone.ledger.repos.attachments.listFor(txId);
    expect(await newPhone.attachments.readAsDataUri(a1 as never)).toBe(
      await phone.attachments.readAsDataUri(
        phone.ledger.repos.attachments.listFor(txId)[0] as never,
      ),
    );
    expect(a2).toBeDefined();
    expect(newPhone.key).not.toEqual(phone.key);
    expect(newPhone.ledger.repos.settings.get('locale')).toBe('ar');
  });

  it('the backup is encrypted: no plaintext notes, names or image bytes', async () => {
    const { phone } = await populated();
    const file = Buffer.from(must(await phone.backup.create(PASS)));
    for (const needle of ['Eid clothes', 'Souq', 'jpeg-bytes-of', 'Cash'])
      expect(file.includes(needle)).toBe(false);
  });

  it('refuses short passphrases', async () => {
    const { phone } = await populated();
    expect(await phone.backup.create('short')).toEqual({
      ok: false,
      error: 'passphrase_too_short',
    });
  });
});

describe('J9 negative paths: nothing is written on failure', () => {
  async function setup() {
    const { phone } = await populated();
    const file = must(await phone.backup.create(PASS));
    const target = emptyPhone();
    const before = fingerprint(target.ledger);
    return { file, target, before };
  }

  it('wrong passphrase → clear error, no partial restore', async () => {
    const { file, target, before } = await setup();
    expect(target.backup.open(file, 'wrong passphrase!')).toEqual({
      ok: false,
      error: 'wrong_passphrase',
    });
    expect(fingerprint(target.ledger)).toEqual(before);
  });

  it.each([
    [
      'a flipped byte in the data',
      (f: Uint8Array) => {
        const c = f.slice();
        c[c.length - 40] = (c[c.length - 40] as number) ^ 1;
        return c;
      },
    ],
    ['truncation', (f: Uint8Array) => f.slice(0, f.length - 25)],
    ['truncation at a frame boundary (missing "end")', (f: Uint8Array) => dropLastFrame(f)],
    ['trailing junk', (f: Uint8Array) => new Uint8Array([...f, 1, 2, 3, 4, 0, 0, 0, 0])],
  ])('%s → corrupt, nothing written', async (_label, damage) => {
    const { file, target, before } = await setup();
    expect(target.backup.open(damage(file), PASS)).toEqual({ ok: false, error: 'corrupt' });
    expect(fingerprint(target.ledger)).toEqual(before);
  });

  it('edited header (e.g. counts) → authentication fails', async () => {
    const { file, target } = await setup();
    const edited = editHeader(file, (h) => ({ ...h, counts: { ...h.counts, transactions: 99 } }));
    expect(target.backup.open(edited, PASS).ok).toBe(false);
  });

  it('not a backup file / unknown format version', async () => {
    const { target } = await setup();
    expect(target.backup.inspect(new TextEncoder().encode('date,amount\n2026-01-01,5'))).toEqual({
      ok: false,
      error: 'not_a_backup',
    });
    const { file } = await setup();
    const v9 = file.slice();
    v9[7] = 9;
    expect(target.backup.inspect(v9)).toEqual({ ok: false, error: 'unsupported_format' });
  });

  it('backup from a newer app schema → "update the app", before asking for the passphrase', async () => {
    const { file, target } = await setup();
    const newer = editHeader(file, (h) => ({ ...h, schemaVersion: SCHEMA_VERSION + 1 }));
    expect(target.backup.inspect(newer)).toEqual({ ok: false, error: 'newer_schema' });
    expect(target.backup.open(newer, PASS)).toEqual({ ok: false, error: 'newer_schema' });
  });

  it('crafted KDF parameters are rejected instead of hanging the phone', async () => {
    const { file, target } = await setup();
    const evil = editHeader(file, (h) => ({ ...h, kdf: { ...h.kdf, m: 4_000_000 } }));
    expect(target.backup.open(evil, PASS)).toEqual({ ok: false, error: 'corrupt' });
  });
});

describe('J9 restore over existing data', () => {
  it('requires explicit confirmation; with it, a safety backup is written first', async () => {
    const { phone } = await populated();
    const file = must(await phone.backup.create(PASS));
    const other = createDevice(); // already has Cash/Bank accounts
    must(
      other.ledger.repos.transactions.create(other.ledger.expense({ note: 'only on this phone' })),
    );
    const before = fingerprint(other.ledger);
    const opened = must(other.backup.open(file, PASS));

    expect(await other.backup.restore(opened, { confirmReplace: false })).toEqual({
      ok: false,
      error: 'needs_confirmation',
    });
    expect(fingerprint(other.ledger)).toEqual(before); // cancel = nothing changed

    const r = must(await other.backup.restore(opened, { confirmReplace: true }));
    expect(r.safetyBackupPath).toMatch(/^backups\/safety-\d+\.masroof$/);
    expect(fingerprint(other.ledger)).toEqual(fingerprint(phone.ledger));

    // The safety backup really contains the replaced data.
    const safety = await other.files.read(r.safetyBackupPath ?? '');
    const third = emptyPhone();
    must(
      await third.backup.restore(must(third.backup.open(safety, PASS)), { confirmReplace: false }),
    );
    expect(fingerprint(third.ledger)).toEqual(before);
  });

  it('if the safety backup cannot be written, nothing is replaced', async () => {
    const { phone } = await populated();
    const file = must(await phone.backup.create(PASS));
    const other = createDevice();
    must(other.ledger.repos.transactions.create(other.ledger.expense()));
    const before = fingerprint(other.ledger);
    other.files.failWritesMatching = /^backups\//;
    expect(
      await other.backup.restore(must(other.backup.open(file, PASS)), { confirmReplace: true }),
    ).toEqual({ ok: false, error: 'restore_failed' });
    expect(fingerprint(other.ledger)).toEqual(before);
  });

  it('a failure while writing attachments leaves data and files untouched', async () => {
    const { phone } = await populated();
    const file = must(await phone.backup.create(PASS));
    const target = emptyPhone();
    target.files.failWritesMatching = /\.restore$/;
    expect(
      await target.backup.restore(must(target.backup.open(file, PASS)), { confirmReplace: true }),
    ).toEqual({ ok: false, error: 'restore_failed' });
    expect(target.ledger.sql.all('SELECT * FROM transactions')).toEqual([]);
    expect([...target.files.files.keys()].filter((k) => k.endsWith('.restore'))).toEqual([]);
  });
});

describe('J9 older schema backups are migrated forward', () => {
  const FIXTURE = join(__dirname, '../../fixtures/backup-schema-v1.masroof');
  const FIXTURE_PASS = 'fixture passphrase v1';

  /** A phone still on schema v1 (Phase 0), with a hand-written ledger. */
  function v1Phone() {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const sql = betterSqliteExecutor(raw);
    migrate(sql, MIGRATIONS.slice(0, 1));
    const now = Date.UTC(2026, 0, 10);
    sql.run(
      `INSERT INTO accounts (id, created_at, updated_at, name, type, currency) VALUES ('0190a1b2-0000-7000-8000-000000000001',?,?,'Cash','cash','USD')`,
      [now, now],
    );
    sql.run(
      `INSERT INTO categories (id, created_at, updated_at, name, kind) VALUES ('0190a1b2-0000-7000-8000-000000000002',?,?,'Food','expense')`,
      [now, now],
    );
    sql.run(
      `INSERT INTO transactions (id, created_at, updated_at, type, account_id, amount_minor, currency, fx_rate_to_base, base_amount_minor, occurred_at, occurred_tz, occurred_on, note)
       VALUES ('0190a1b2-0000-7000-8000-000000000003',?,?,'expense','0190a1b2-0000-7000-8000-000000000001',12300,'USD','1',12300,?,'UTC','2026-01-10','v1 note')`,
      [now, now, now],
    );
    sql.run(
      `INSERT INTO transaction_splits (id, created_at, updated_at, transaction_id, category_id, amount_minor) VALUES ('0190a1b2-0000-7000-8000-000000000004',?,?,'0190a1b2-0000-7000-8000-000000000003','0190a1b2-0000-7000-8000-000000000002',12300)`,
      [now, now],
    );
    const db = drizzle(raw, { schema }) as unknown as AppDatabase;
    const t = {
      raw,
      sql,
      db,
      now: () => now,
      newId: createIdFactory(seededBytes(1), () => now),
      clock: { now },
    };
    return createDevice({
      ...t,
      repos: createRepositories({ ...t, timeZone: () => 'UTC' }),
    } as unknown as Ledger);
  }

  it('fixture file exists (regenerate with UPDATE_FIXTURES=1)', async () => {
    if (process.env.UPDATE_FIXTURES === '1') {
      const file = must(await v1Phone().backup.create(FIXTURE_PASS));
      writeFileSync(FIXTURE, file);
    }
    const header = readHeader(new Uint8Array(readFileSync(FIXTURE)));
    expect(header.ok && header.header.schemaVersion).toBe(1);
  });

  it('restores a schema-v1 backup into the current schema, backfilling new columns', () => {
    const file = new Uint8Array(readFileSync(FIXTURE));
    const target = emptyPhone();
    const opened = must(target.backup.open(file, FIXTURE_PASS));
    expect(opened.payload.schemaVersion).toBe(1);
    return target.backup.restore(opened, { confirmReplace: false }).then((r) => {
      must(r);
      const split = target.ledger.sql.all<{ b: number }>(
        'SELECT base_amount_minor AS b FROM transaction_splits',
      );
      expect(split).toEqual([{ b: 12300 }]); // column added by migration 2, backfilled
      expect(target.ledger.repos.transactions.list({}, null).map((x) => x.note)).toEqual([
        'v1 note',
      ]);
      expect(integrityReport(target.ledger.sql).ok).toBe(true);
    });
  });
});

describe('J9 crafted backups (valid passphrase, hostile content)', () => {
  function craft(
    payload: unknown,
    attachments: { id: string; bytes: Uint8Array }[] = [],
    counts?: Record<string, number>,
  ) {
    const salt = rnd(16);
    const key = deriveFromSecret(PASS, salt, TEST_KDF);
    const tables = (payload as { tables: Record<string, { rows: unknown[] }> }).tables;
    return encodeBackup({
      header: {
        format: 1,
        schemaVersion: SCHEMA_VERSION,
        appVersion: 'evil',
        createdAt: 1,
        kdf: { ...TEST_KDF, salt: bytesToHex(salt) },
        counts:
          counts ?? Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.rows.length])),
        attachments: attachments.length,
      },
      key,
      frames: [
        { type: FrameType.Db, json: JSON.stringify(payload) },
        ...attachments.map((a) => ({ type: FrameType.Attachment as const, ...a })),
      ],
      randomBytes: rnd,
    });
  }

  it('unknown table names are rejected', () => {
    const file = craft({
      schemaVersion: SCHEMA_VERSION,
      tables: { 'accounts; DROP TABLE settings': { columns: ['id'], rows: [] } },
    });
    expect(emptyPhone().backup.open(file, PASS)).toEqual({ ok: false, error: 'corrupt' });
  });

  it('non-scalar values are rejected', () => {
    const file = craft({
      schemaVersion: SCHEMA_VERSION,
      tables: { settings: { columns: ['key', 'value', 'updated_at'], rows: [['k', { $: 1 }, 1]] } },
    });
    expect(emptyPhone().backup.open(file, PASS)).toEqual({ ok: false, error: 'corrupt' });
  });

  it('injected column names are ignored (only real columns are written)', async () => {
    const target = emptyPhone();
    const file = craft({
      schemaVersion: SCHEMA_VERSION,
      tables: {
        settings: {
          columns: ['key', 'value', 'updated_at', 'x) VALUES (1,1,1); DROP TABLE accounts; --'],
          rows: [['theme', '"dark"', 1, 'boom']],
        },
      },
    });
    must(
      await target.backup.restore(must(target.backup.open(file, PASS)), { confirmReplace: false }),
    );
    expect(target.ledger.repos.settings.get('theme')).toBe('dark');
    expect(
      target.ledger.sql.all(`SELECT name FROM sqlite_master WHERE name = 'accounts'`),
    ).toHaveLength(1);
  });

  it('attachment paths from the file are never used (no path traversal)', async () => {
    const { phone, txId } = await populated();
    const real = must(await phone.backup.create(PASS));
    const target = emptyPhone();
    const opened = must(target.backup.open(real, PASS));
    const att = opened.payload.tables.attachments;
    if (!att) throw new Error('no attachments');
    const pathIdx = att.columns.indexOf('file_path');
    att.rows.forEach((r) => (r[pathIdx] = '../../../../etc/passwd'));
    must(await target.backup.restore(opened, { confirmReplace: false }));
    const paths = target.ledger.repos.attachments.listFor(txId).map((a) => a.filePath);
    expect(paths.every((p) => /^attachments\/[0-9a-f-]{36}\.bin$/.test(p))).toBe(true);
    expect([...target.files.files.keys()].some((k) => k.includes('..'))).toBe(false);
  });

  it('malformed attachment ids or checksum mismatches are rejected', async () => {
    const bad = craft(
      { schemaVersion: SCHEMA_VERSION, tables: {} },
      [{ id: '../x', bytes: new Uint8Array([1]) }],
      {},
    );
    expect(emptyPhone().backup.open(bad, PASS)).toEqual({ ok: false, error: 'corrupt' });
  });

  it('rows violating foreign keys roll back the whole restore', async () => {
    const target = emptyPhone();
    const file = craft({
      schemaVersion: SCHEMA_VERSION,
      tables: {
        transaction_splits: {
          columns: [
            'id',
            'created_at',
            'updated_at',
            'transaction_id',
            'category_id',
            'amount_minor',
          ],
          rows: [['0190a1b2-0000-7000-8000-00000000000a', 1, 1, 'missing-tx', 'missing-cat', 5]],
        },
      },
    });
    expect(
      await target.backup.restore(must(target.backup.open(file, PASS)), { confirmReplace: true }),
    ).toEqual({ ok: false, error: 'restore_failed' });
    expect(target.ledger.sql.all('SELECT * FROM transaction_splits')).toEqual([]);
  });
});

// --- helpers --------------------------------------------------------------

function editHeader(
  file: Uint8Array,
  edit: (
    h: Record<string, never> & { counts: Record<string, number>; kdf: Record<string, unknown> },
  ) => unknown,
) {
  const h = readHeader(file);
  if (!h.ok) throw new Error('bad fixture');
  const json = new TextEncoder().encode(JSON.stringify(edit(h.header as never)));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, json.length, false);
  return new Uint8Array([...file.slice(0, 8), ...len, ...json, ...file.slice(h.offset)]);
}

function dropLastFrame(file: Uint8Array): Uint8Array {
  const h = readHeader(file);
  if (!h.ok) throw new Error('bad');
  const view = new DataView(file.buffer, file.byteOffset);
  let offset = h.offset;
  let lastStart = offset;
  while (offset < file.length) {
    lastStart = offset;
    offset += 4 + view.getUint32(offset, false);
  }
  return file.slice(0, lastStart);
}
