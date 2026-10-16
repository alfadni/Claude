import type { SqlExecutor } from '../sql-executor';
import { migration0001 } from './0001_initial';
import { migration0002 } from './0002_ledger';
import { migration0003 } from './0003_planning';
import { migration0004 } from './0004_performance';

export type Migration = Readonly<{ version: number; name: string; statements: readonly string[] }>;

/** Append-only. Never edit a shipped migration; add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export type MigrationOutcome =
  | { status: 'up_to_date'; version: number }
  | { status: 'migrated'; from: number; to: number }
  | { status: 'newer_than_app'; dbVersion: number; appVersion: number };

export function currentVersion(db: SqlExecutor): number {
  const row = db.all<{ user_version: number }>('PRAGMA user_version')[0];
  return row?.user_version ?? 0;
}

/**
 * Bring the database to SCHEMA_VERSION. Each migration runs in its own
 * transaction together with its user_version bump, so a crash leaves the DB at
 * the previous version — never half-migrated.
 *
 * A database written by a newer app is left untouched (J9: "update the app").
 */
export function migrate(
  db: SqlExecutor,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationOutcome {
  assertOrdered(migrations);
  const target = migrations[migrations.length - 1]?.version ?? 0;
  const from = currentVersion(db);

  if (from > target) return { status: 'newer_than_app', dbVersion: from, appVersion: target };
  if (from === target) return { status: 'up_to_date', version: from };

  for (const m of migrations) {
    if (m.version <= from) continue;
    db.transaction(() => {
      for (const statement of m.statements) db.exec(statement);
      // PRAGMA cannot be parameterised; version is a trusted integer constant.
      db.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`);
    });
  }
  return { status: 'migrated', from, to: target };
}

function assertOrdered(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migrations must be numbered 1..n without gaps (found ${m.version} at ${i})`);
    }
  });
}
