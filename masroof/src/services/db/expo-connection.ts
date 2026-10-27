import { drizzle } from 'drizzle-orm/expo-sqlite';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import type { AppDatabase } from '@/data/database';
import { schema } from '@/data/schema';
import type { SqlExecutor, SqlValue } from '@/data/sql-executor';

import { isValidKeyHex, type DbConnection, type OpenDeps, type SecretStore } from './open-database';

const DB_FILE = 'masroof.db';

const secureOptions: SecureStore.SecureStoreOptions = {
  // Never synced to iCloud Keychain / Google backup; unreadable while locked.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const expoSecretStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key, secureOptions),
  set: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
};

function executor(raw: SQLiteDatabase): SqlExecutor {
  return {
    exec: (sql) => raw.execSync(sql),
    run: (sql, params: readonly SqlValue[] = []) => {
      raw.runSync(sql, [...params]);
    },
    all: <T>(sql: string, params: readonly SqlValue[] = []) => raw.getAllSync<T>(sql, [...params]),
    transaction: <T>(fn: () => T): T => {
      let result: T | undefined;
      raw.withTransactionSync(() => {
        result = fn();
      });
      return result as T;
    },
  };
}

export function openExpoConnection(keyHex: string): DbConnection {
  // Defence in depth: the key is interpolated into a PRAGMA, so it must be hex.
  if (!isValidKeyHex(keyHex)) throw new Error('Refusing to open DB with a malformed key');
  const raw = openDatabaseSync(DB_FILE);
  // Raw 256-bit key (x'..') skips SQLCipher's PBKDF2 — the key is already random.
  raw.execSync(`PRAGMA key = "x'${keyHex}'"`);
  return {
    sql: executor(raw),
    db: drizzle(raw, { schema }) as unknown as AppDatabase,
    cipherVersion: () => {
      const row = raw.getAllSync<{ cipher_version?: string }>('PRAGMA cipher_version')[0];
      return row?.cipher_version ?? null;
    },
    close: () => raw.closeSync(),
  };
}

export const expoOpenDeps: OpenDeps = {
  secrets: expoSecretStore,
  randomBytes: getRandomBytes,
  openConnection: openExpoConnection,
  requireCipher: true,
};
