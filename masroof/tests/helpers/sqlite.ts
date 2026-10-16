import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDatabase, DataDeps } from '@/data/database';
import { migrate } from '@/data/migrations';
import { schema } from '@/data/schema';
import type { SqlExecutor, SqlValue } from '@/data/sql-executor';
import { createIdFactory } from '@/domain';

/** Deterministic PRNG so ids are reproducible across runs. */
export function seededBytes(seed = 1) {
  let s = seed >>> 0;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  };
}

export function betterSqliteExecutor(raw: Database.Database): SqlExecutor {
  return {
    exec: (sql) => {
      raw.exec(sql);
    },
    run: (sql, params: readonly SqlValue[] = []) => {
      raw.prepare(sql).run(...params);
    },
    runMany: (sql, rows) => {
      const statement = raw.prepare(sql);
      for (const params of rows) statement.run(...params);
    },
    all: <T>(sql: string, params: readonly SqlValue[] = []) => {
      const stmt = raw.prepare(sql);
      return (stmt.reader ? stmt.all(...params) : (stmt.run(...params), [])) as T[];
    },
    transaction: <T>(fn: () => T): T => raw.transaction(fn)(),
  };
}

export type TestDb = DataDeps & { raw: Database.Database; clock: { now: number } };

/** In-memory SQLite with the real migrations applied. */
export function createTestDb(options: { migrate?: boolean } = {}): TestDb {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  const sql = betterSqliteExecutor(raw);
  if (options.migrate !== false) migrate(sql);
  const clock = { now: Date.UTC(2026, 9, 15, 9, 0) };
  const now = () => clock.now;
  return {
    raw,
    sql,
    db: drizzle(raw, { schema }) as unknown as AppDatabase,
    now,
    newId: createIdFactory(seededBytes(7), now),
    clock,
  };
}
