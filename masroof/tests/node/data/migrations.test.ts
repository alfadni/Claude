import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  currentVersion,
  migrate,
  MIGRATIONS,
  SCHEMA_VERSION,
  type Migration,
} from '@/data/migrations';
import { schema } from '@/data/schema';

import { createTestDb } from '../../helpers/sqlite';

describe('migration runner', () => {
  it('migrates a fresh database to the latest version', () => {
    const t = createTestDb({ migrate: false });
    expect(currentVersion(t.sql)).toBe(0);
    expect(migrate(t.sql)).toEqual({ status: 'migrated', from: 0, to: SCHEMA_VERSION });
    expect(currentVersion(t.sql)).toBe(SCHEMA_VERSION);
  });

  it('is idempotent', () => {
    const t = createTestDb();
    expect(migrate(t.sql)).toEqual({ status: 'up_to_date', version: SCHEMA_VERSION });
  });

  it('refuses to touch a database from a newer app (J9)', () => {
    const t = createTestDb();
    t.sql.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    const before = t.sql.all('SELECT name FROM sqlite_master ORDER BY name');
    expect(migrate(t.sql)).toEqual({
      status: 'newer_than_app',
      dbVersion: SCHEMA_VERSION + 1,
      appVersion: SCHEMA_VERSION,
    });
    expect(t.sql.all('SELECT name FROM sqlite_master ORDER BY name')).toEqual(before);
  });

  it('rolls back a failing migration completely', () => {
    const t = createTestDb();
    const broken: Migration = {
      version: SCHEMA_VERSION + 1,
      name: 'broken',
      statements: ['CREATE TABLE half_done (id TEXT)', 'THIS IS NOT SQL'],
    };
    expect(() => migrate(t.sql, [...MIGRATIONS, broken])).toThrow();
    expect(currentVersion(t.sql)).toBe(SCHEMA_VERSION);
    expect(t.sql.all("SELECT name FROM sqlite_master WHERE name = 'half_done'")).toEqual([]);
  });

  it('applies only pending migrations, in order', () => {
    const t = createTestDb();
    const next: Migration = {
      version: SCHEMA_VERSION + 1,
      name: 'add_column',
      statements: ['ALTER TABLE accounts ADD COLUMN nickname TEXT'],
    };
    expect(migrate(t.sql, [...MIGRATIONS, next])).toEqual({
      status: 'migrated',
      from: SCHEMA_VERSION,
      to: SCHEMA_VERSION + 1,
    });
  });

  it('rejects gaps in numbering', () => {
    const t = createTestDb({ migrate: false });
    const gap: Migration = { version: 3, name: 'gap', statements: [] };
    expect(() => migrate(t.sql, [...MIGRATIONS, gap])).toThrow(/without gaps/);
  });
});

describe('schema drift: Drizzle definitions match migrated DDL', () => {
  const t = createTestDb();
  const tables = Object.values(schema) as SQLiteTable[];

  it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
    '%s',
    (_name, table) => {
      const config = getTableConfig(table);
      const info = t.sql.all<{ name: string; notnull: number; pk: number }>(
        `PRAGMA table_info(${config.name})`,
      );
      expect(info.length).toBeGreaterThan(0);

      const ddl = Object.fromEntries(
        info.map((c) => [c.name, { notNull: c.notnull === 1 || c.pk > 0 }]),
      );
      const orm = Object.fromEntries(
        config.columns.map((c) => [c.name, { notNull: c.notNull || c.primary }]),
      );
      expect(orm).toEqual(ddl);
    },
  );

  it('has no REAL columns anywhere (no floating-point money)', () => {
    const real = t.sql.all<{ tbl: string; col: string }>(
      `SELECT m.name AS tbl, p.name AS col FROM sqlite_master m, pragma_table_info(m.name) p
       WHERE m.type = 'table' AND upper(p.type) IN ('REAL','FLOAT','DOUBLE','NUMERIC')`,
    );
    expect(real).toEqual([]);
  });
});
