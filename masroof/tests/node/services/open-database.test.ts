import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDatabase } from '@/data/database';
import { currentVersion, SCHEMA_VERSION } from '@/data/migrations';
import { schema } from '@/data/schema';
import {
  DB_KEY_NAME,
  isValidKeyHex,
  openEncryptedDatabase,
  toHex,
  type DbConnection,
  type OpenDeps,
  type SecretStore,
} from '@/services/db/open-database';

import { betterSqliteExecutor, seededBytes } from '../../helpers/sqlite';

/**
 * Simulates SQLCipher on top of plain SQLite: the "file" remembers the key it
 * was first written with, and opening it with another key fails like
 * SQLCipher's "file is not a database".
 */
class FakeEncryptedFile {
  raw = new Database(':memory:');
  key: string | null = null;
  opens = 0;

  connect(withCipher = true) {
    return (keyHex: string): DbConnection => {
      this.opens++;
      const file = this;
      const real = betterSqliteExecutor(this.raw);
      const locked = this.key !== null && this.key !== keyHex;
      const check = () => {
        if (locked) throw new Error('file is not a database');
      };
      const bind = () => {
        if (file.key === null && file.hasData()) file.key = keyHex;
      };
      return {
        sql: {
          exec: (q) => (check(), real.exec(q), bind()),
          run: (q, p) => (check(), real.run(q, p), bind()),
          all: <T>(q: string, p?: readonly (string | number | null)[]) => {
            check();
            const rows = real.all<T>(q, p);
            bind();
            return rows;
          },
          transaction: <T>(fn: () => T) => {
            check();
            const r = real.transaction(fn);
            bind();
            return r;
          },
        },
        db: drizzle(this.raw, { schema }) as unknown as AppDatabase,
        cipherVersion: () => (withCipher ? '4.6.1 community' : null),
        close: () => undefined,
      };
    };
  }

  hasData() {
    return (
      (this.raw.prepare('SELECT count(*) AS n FROM sqlite_master').get() as { n: number }).n > 0
    );
  }
}

class MemorySecrets implements SecretStore {
  values = new Map<string, string>();
  failWrites = false;
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    if (this.failWrites) throw new Error('keystore unavailable');
    this.values.set(key, value);
  }
}

function setup(over: Partial<OpenDeps> = {}) {
  const file = new FakeEncryptedFile();
  const secrets = new MemorySecrets();
  const deps: OpenDeps = {
    secrets,
    randomBytes: seededBytes(3),
    openConnection: file.connect(),
    requireCipher: true,
    ...over,
  };
  return { file, secrets, deps };
}

describe('openEncryptedDatabase', () => {
  it('first launch: creates a 256-bit key, stores it, migrates', async () => {
    const { file, secrets, deps } = setup();
    const r = await openEncryptedDatabase(deps);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.createdKey).toBe(true);
    const key = secrets.values.get(DB_KEY_NAME) ?? '';
    expect(isValidKeyHex(key)).toBe(true);
    expect(key).toHaveLength(64);
    expect(file.key).toBe(key);
    expect(currentVersion(r.connection.sql)).toBe(SCHEMA_VERSION);
    expect(r.connection.sql.all('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]);
  });

  it('next launch: reuses the stored key', async () => {
    const { secrets, deps } = setup();
    await openEncryptedDatabase(deps);
    const key = secrets.values.get(DB_KEY_NAME);
    const r = await openEncryptedDatabase(deps);
    expect(r).toMatchObject({ status: 'ready', createdKey: false });
    expect(secrets.values.get(DB_KEY_NAME)).toBe(key);
  });

  it('key lost (e.g. restored phone): reports it, never overwrites data or stores a new key', async () => {
    const { file, secrets, deps } = setup();
    await openEncryptedDatabase(deps);
    secrets.values.clear();
    const r = await openEncryptedDatabase(deps);
    expect(r).toEqual({ status: 'key_lost' });
    expect(secrets.values.size).toBe(0);
    expect(file.hasData()).toBe(true);
  });

  it('wrong key in store: reports undecryptable without touching the file', async () => {
    const { file, secrets, deps } = setup();
    await openEncryptedDatabase(deps);
    secrets.values.set(DB_KEY_NAME, 'f'.repeat(64));
    expect(await openEncryptedDatabase(deps)).toEqual({ status: 'undecryptable' });
    expect(file.hasData()).toBe(true);
  });

  it('malformed key in store: refuses before opening', async () => {
    const { file, secrets, deps } = setup();
    secrets.values.set(DB_KEY_NAME, "abc'; DROP TABLE x; --");
    expect(await openEncryptedDatabase(deps)).toEqual({ status: 'undecryptable' });
    expect(file.opens).toBe(0);
  });

  it('SQLCipher missing (Expo Go): refuses to run unencrypted', async () => {
    const file = new FakeEncryptedFile();
    const { deps, secrets } = setup({ openConnection: file.connect(false) });
    expect(await openEncryptedDatabase(deps)).toEqual({ status: 'cipher_unavailable' });
    expect(file.hasData()).toBe(false);
    expect(secrets.values.size).toBe(0);
  });

  it('keystore write fails: nothing is written to the database', async () => {
    const { file, secrets, deps } = setup();
    secrets.failWrites = true;
    expect(await openEncryptedDatabase(deps)).toEqual({ status: 'secure_store_failed' });
    expect(file.hasData()).toBe(false);
  });

  it('keystore silently drops the write: detected by read-back', async () => {
    const { file, deps } = setup({
      secrets: { get: async () => null, set: async () => undefined },
    });
    expect(await openEncryptedDatabase(deps)).toEqual({ status: 'secure_store_failed' });
    expect(file.hasData()).toBe(false);
  });

  it('broken RNG output is rejected', async () => {
    const { deps } = setup({ randomBytes: () => new Uint8Array(8) });
    expect(await openEncryptedDatabase(deps)).toEqual({ status: 'secure_store_failed' });
  });

  it('database from a newer app version: left untouched', async () => {
    const { deps } = setup();
    const first = await openEncryptedDatabase(deps);
    if (first.status !== 'ready') throw new Error('setup failed');
    first.connection.sql.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
    expect(await openEncryptedDatabase(deps)).toEqual({
      status: 'newer_schema',
      dbVersion: SCHEMA_VERSION + 5,
      appVersion: SCHEMA_VERSION,
    });
  });

  it('toHex encodes bytes', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });
});
