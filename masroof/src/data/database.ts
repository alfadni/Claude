import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { Id } from '@/domain';

import type { Schema } from './schema';
import type { SqlExecutor } from './sql-executor';

/** Drizzle handle, driver-agnostic (expo-sqlite on device, better-sqlite3 in tests). */
export type AppDatabase = BaseSQLiteDatabase<'sync', unknown, Schema>;

/** Everything the data layer needs from the outside world. */
export type DataDeps = Readonly<{
  db: AppDatabase;
  sql: SqlExecutor;
  now: () => number;
  newId: () => Id;
}>;
