import { eq } from 'drizzle-orm';

import {
  DEFAULT_SETTINGS,
  isSettingKey,
  SETTING_VALIDATORS,
  type SettingKey,
  type Settings,
} from '@/domain/settings';

import type { DataDeps } from '../database';
import { settings } from '../schema';
import { withUnitOfWork } from '../unit-of-work';

export class InvalidSettingError extends Error {
  constructor(key: string) {
    // Deliberately excludes the value: settings may be user data.
    super(`Invalid value for setting "${key}"`);
    this.name = 'InvalidSettingError';
  }
}

export function createSettingsRepository(deps: DataDeps) {
  function parseStored<K extends SettingKey>(key: K, raw: string | undefined): Settings[K] {
    if (raw === undefined) return DEFAULT_SETTINGS[key];
    try {
      const value: unknown = JSON.parse(raw);
      // Corrupt or out-of-range values fall back to the default rather than
      // crashing the app on launch.
      return SETTING_VALIDATORS[key](value) ? value : DEFAULT_SETTINGS[key];
    } catch {
      return DEFAULT_SETTINGS[key];
    }
  }

  return {
    get<K extends SettingKey>(key: K): Settings[K] {
      const row = deps.db.select().from(settings).where(eq(settings.key, key)).get();
      return parseStored(key, row?.value);
    },

    getAll(): Settings {
      const out: Settings = { ...DEFAULT_SETTINGS };
      for (const row of deps.db.select().from(settings).all()) {
        if (isSettingKey(row.key)) {
          (out as Record<SettingKey, unknown>)[row.key] = parseStored(row.key, row.value);
        }
      }
      return out;
    },

    set<K extends SettingKey>(key: K, value: Settings[K]): void {
      if (!SETTING_VALIDATORS[key](value)) throw new InvalidSettingError(key);
      withUnitOfWork(deps, ({ tx, now, audit }) => {
        const before = tx.select().from(settings).where(eq(settings.key, key)).get();
        const json = JSON.stringify(value);
        if (before?.value === json) return;
        tx.insert(settings)
          .values({ key, value: json, updatedAt: now })
          .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: now } })
          .run();
        audit({
          entity: 'settings',
          entityId: key,
          action: before ? 'update' : 'create',
          before: before ? JSON.parse(before.value) : undefined,
          after: value,
        });
      });
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
