import type { AppDatabase } from '@/data/database';
import { migrate, SCHEMA_VERSION } from '@/data/migrations';
import type { SqlExecutor } from '@/data/sql-executor';

/** Port over Keychain / Android Keystore (expo-secure-store on device). */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export type DbConnection = Readonly<{
  sql: SqlExecutor;
  db: AppDatabase;
  /** SQLCipher build version, or null when the driver is plain SQLite. */
  cipherVersion(): string | null;
  close(): void;
}>;

export type OpenDeps = Readonly<{
  secrets: SecretStore;
  randomBytes: (n: number) => Uint8Array;
  /** Opens the DB file and applies the key before any other statement. */
  openConnection: (keyHex: string) => DbConnection;
  /** Must be true on device; false only for the plain-SQLite test driver. */
  requireCipher: boolean;
}>;

export type OpenResult =
  | { status: 'ready'; connection: DbConnection; createdKey: boolean }
  /** SQLCipher is not linked (e.g. Expo Go). Never fall back to plaintext. */
  | { status: 'cipher_unavailable' }
  /** Key missing but an encrypted DB exists (device restore, keystore reset). */
  | { status: 'key_lost' }
  /** Key present but the file cannot be read: corruption or a foreign key. */
  | { status: 'undecryptable' }
  /** The secure store refused to persist a new key; nothing was written. */
  | { status: 'secure_store_failed' }
  /** DB written by a newer app version. Left untouched. */
  | { status: 'newer_schema'; dbVersion: number; appVersion: number };

export const DB_KEY_NAME = 'masroof.db.key.v1';
const KEY_PATTERN = /^[0-9a-f]{64}$/;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isValidKeyHex(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/**
 * Open the encrypted database safely. The design rule is: never destroy or
 * overwrite user data automatically. Every unexpected state is reported to the
 * UI, which offers restore-from-backup or an explicit, confirmed reset.
 */
export async function openEncryptedDatabase(deps: OpenDeps): Promise<OpenResult> {
  const stored = await deps.secrets.get(DB_KEY_NAME);
  const createdKey = stored === null;
  if (stored !== null && !isValidKeyHex(stored)) return { status: 'undecryptable' };
  const keyHex = stored ?? toHex(deps.randomBytes(32));
  if (!isValidKeyHex(keyHex)) return { status: 'secure_store_failed' };

  const connection = deps.openConnection(keyHex);
  const fail = <R extends OpenResult>(r: R): R => {
    connection.close();
    return r;
  };

  if (deps.requireCipher && !connection.cipherVersion()) {
    return fail({ status: 'cipher_unavailable' });
  }

  try {
    // With SQLCipher a wrong key surfaces here as "file is not a database".
    connection.sql.all('SELECT count(*) AS n FROM sqlite_master');
  } catch {
    return fail({ status: createdKey ? 'key_lost' : 'undecryptable' });
  }

  if (createdKey) {
    // Persist the key BEFORE writing anything, so data can never exist
    // encrypted under a key we failed to keep.
    try {
      await deps.secrets.set(DB_KEY_NAME, keyHex);
      if ((await deps.secrets.get(DB_KEY_NAME)) !== keyHex) throw new Error('readback mismatch');
    } catch {
      return fail({ status: 'secure_store_failed' });
    }
  }

  connection.sql.exec('PRAGMA foreign_keys = ON');
  connection.sql.exec('PRAGMA journal_mode = WAL');

  const outcome = migrate(connection.sql);
  if (outcome.status === 'newer_than_app') {
    return fail({
      status: 'newer_schema',
      dbVersion: outcome.dbVersion,
      appVersion: SCHEMA_VERSION,
    });
  }
  return { status: 'ready', connection, createdKey };
}
