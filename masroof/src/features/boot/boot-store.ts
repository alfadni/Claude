import { getRandomBytes } from 'expo-crypto';
import { getCalendars, getLocales } from 'expo-localization';
import type { i18n as I18n } from 'i18next';
import { create } from 'zustand';

import type { DataDeps } from '@/data/database';
import {
  createSettingsRepository,
  type SettingsRepository,
} from '@/data/repositories/settings-repository';
import { createIdFactory } from '@/domain';
import type { SettingKey, Settings } from '@/domain/settings';
import { createI18n } from '@/i18n';
import { applyDirection } from '@/i18n/direction';
import { expoOpenDeps } from '@/services/db/expo-connection';
import { openEncryptedDatabase, type OpenDeps, type OpenResult } from '@/services/db/open-database';
import { deviceDefaults } from '@/services/locale/device-defaults';

export type BootErrorKind = Exclude<OpenResult['status'], 'ready'> | 'unexpected';

type Ready = {
  status: 'ready';
  data: DataDeps;
  settingsRepo: SettingsRepository;
  settings: Settings;
  i18n: I18n;
  /** True when a language change needs an app reload to flip layout direction. */
  restartRequired: boolean;
};

export type BootState =
  { status: 'opening'; i18n: I18n } | { status: 'error'; kind: BootErrorKind; i18n: I18n } | Ready;

type BootStore = BootState & {
  boot: (deps?: OpenDeps) => Promise<void>;
  updateSetting: <K extends SettingKey>(key: K, value: Settings[K]) => void;
};

function deviceLocaleInfo() {
  const locale = getLocales()[0];
  const calendar = getCalendars()[0];
  return deviceDefaults({
    languageTag: locale?.languageTag,
    currencyCode: locale?.currencyCode,
    firstWeekday: calendar?.firstWeekday,
    timeZone: calendar?.timeZone,
  });
}

export const useBootStore = create<BootStore>((set, get) => {
  // Replace (not merge) on status changes, so an error state can never keep
  // a stale DB handle or settings from a previous session.
  const transition = (next: BootState) =>
    set({ ...next, boot: get().boot, updateSetting: get().updateSetting }, true);

  return {
    status: 'opening',
    i18n: createI18n(deviceLocaleInfo().locale),

    async boot(deps = expoOpenDeps) {
      transition({ status: 'opening', i18n: get().i18n });
      try {
        const result = await openEncryptedDatabase(deps);
        if (result.status !== 'ready') {
          transition({ status: 'error', kind: result.status, i18n: get().i18n });
          return;
        }
        const data: DataDeps = {
          db: result.connection.db,
          sql: result.connection.sql,
          now: Date.now,
          newId: createIdFactory(getRandomBytes),
        };
        const settingsRepo = createSettingsRepository(data);
        if (result.createdKey) {
          // Fresh install: seed locale/currency/week start from the device (J1 skip path).
          const d = deviceLocaleInfo();
          settingsRepo.set('locale', d.locale);
          settingsRepo.set('baseCurrency', d.baseCurrency);
          settingsRepo.set('firstDayOfWeek', d.firstDayOfWeek);
        }
        const settings = settingsRepo.getAll();
        applyDirection(settings.locale);
        transition({
          status: 'ready',
          data,
          settingsRepo,
          settings,
          i18n: createI18n(settings.locale),
          restartRequired: false,
        });
      } catch {
        // No details: errors here may carry SQL or paths. Crash reporting is opt-in (Phase 5).
        transition({ status: 'error', kind: 'unexpected', i18n: get().i18n });
      }
    },

    updateSetting(key, value) {
      const state = get();
      if (state.status !== 'ready') return;
      state.settingsRepo.set(key, value);
      const settings = state.settingsRepo.getAll();
      const patch: Partial<Ready> = { settings };
      if (key === 'locale') {
        patch.i18n = createI18n(settings.locale);
        patch.restartRequired = applyDirection(settings.locale);
      }
      set(patch);
    },
  };
});
