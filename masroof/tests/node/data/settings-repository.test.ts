import {
  createSettingsRepository,
  InvalidSettingError,
} from '@/data/repositories/settings-repository';
import { auditLog, settings } from '@/data/schema';
import { withUnitOfWork } from '@/data/unit-of-work';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/settings';

import { createTestDb } from '../../helpers/sqlite';

describe('settings repository', () => {
  it('returns defaults on a fresh install', () => {
    const repo = createSettingsRepository(createTestDb());
    expect(repo.getAll()).toEqual(DEFAULT_SETTINGS);
    expect(repo.get('lockTimeoutSeconds')).toBe(60);
  });

  it('persists values and writes an audit row per change', () => {
    const t = createTestDb();
    const repo = createSettingsRepository(t);
    repo.set('locale', 'ar');
    repo.set('baseCurrency', 'SDG');
    repo.set('baseCurrency', 'USD');

    expect(repo.get('locale')).toBe('ar');
    expect(repo.getAll()).toMatchObject({ locale: 'ar', baseCurrency: 'USD' });

    const rows = t.db.select().from(auditLog).all();
    expect(rows.map((r) => [r.entityId, r.action])).toEqual([
      ['locale', 'create'],
      ['baseCurrency', 'create'],
      ['baseCurrency', 'update'],
    ]);
    expect(JSON.parse(rows[2]?.beforeJson ?? 'null')).toBe('SDG');
    expect(JSON.parse(rows[2]?.afterJson ?? 'null')).toBe('USD');
  });

  it('does not write an audit row when nothing changed', () => {
    const t = createTestDb();
    const repo = createSettingsRepository(t);
    repo.set('theme', 'dark');
    repo.set('theme', 'dark');
    expect(t.db.select().from(auditLog).all()).toHaveLength(1);
  });

  it('rejects invalid values without writing anything', () => {
    const t = createTestDb();
    const repo = createSettingsRepository(t);
    expect(() => repo.set('baseCurrency', 'XYZ' as Settings['baseCurrency'])).toThrow(
      InvalidSettingError,
    );
    expect(() => repo.set('lockTimeoutSeconds', -1)).toThrow(InvalidSettingError);
    expect(() => repo.set('lockTimeoutSeconds', 1.5)).toThrow(InvalidSettingError);
    expect(() => repo.set('firstDayOfWeek', 7 as Settings['firstDayOfWeek'])).toThrow(
      InvalidSettingError,
    );
    expect(t.db.select().from(auditLog).all()).toHaveLength(0);
  });

  it('error messages never include the rejected value', () => {
    const repo = createSettingsRepository(createTestDb());
    try {
      repo.set('baseCurrency', 'SECRET' as Settings['baseCurrency']);
    } catch (e) {
      expect(String(e)).not.toContain('SECRET');
    }
  });

  it('falls back to defaults for corrupt or out-of-range stored values', () => {
    const t = createTestDb();
    t.sql.run(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)`, [
      'locale',
      '"fr"',
      1,
    ]);
    t.sql.run(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)`, ['theme', '42', 1]);
    t.sql.run(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)`, [
      'legacyKey',
      '1',
      1,
    ]);
    const repo = createSettingsRepository(t);
    expect(repo.get('locale')).toBe('en');
    expect(repo.getAll()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('unit of work', () => {
  it('rolls back data and audit together when the operation throws', () => {
    const t = createTestDb();
    const repo = createSettingsRepository(t);
    expect(() =>
      withUnitOfWork(t, ({ tx, audit }) => {
        audit({ entity: 'settings', entityId: 'locale', action: 'create', after: 'ar' });
        tx.insert(settings).values({ key: 'locale', value: '"ar"', updatedAt: 1 }).run();
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(repo.get('locale')).toBe('en');
    expect(t.db.select().from(auditLog).all()).toHaveLength(0);
  });

  it('groups all audit rows of one operation under one batch id', () => {
    const t = createTestDb();
    withUnitOfWork(t, ({ audit }) => {
      audit({ entity: 'x', entityId: '1', action: 'create', after: {} });
      audit({ entity: 'x', entityId: '2', action: 'create', after: {} });
    });
    withUnitOfWork(t, ({ audit }) => audit({ entity: 'x', entityId: '3', action: 'delete' }));
    const batches = t.db
      .select()
      .from(auditLog)
      .all()
      .map((r) => r.batchId);
    expect(batches[0]).toBe(batches[1]);
    expect(batches[2]).not.toBe(batches[0]);
  });
});
