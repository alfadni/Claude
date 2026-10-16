import { getCalendars, getLocales } from 'expo-localization';
import type { i18n as I18n } from 'i18next';
import { create } from 'zustand';

import { createRepositories, type Repositories } from '@/data/repositories';
import { createIdFactory } from '@/domain';
import type { SettingKey, Settings } from '@/domain/settings';
import { createI18n } from '@/i18n';
import { applyDirection } from '@/i18n/direction';
import {
  createAttachmentService,
  type AttachmentService,
} from '@/services/attachments/attachment-service';
import { expoOpenDeps } from '@/services/db/expo-connection';
import { openEncryptedDatabase, type OpenDeps, type OpenResult } from '@/services/db/open-database';
import { deviceDefaults, type DeviceDefaults } from '@/services/locale/device-defaults';
import {
  createOnboardingService,
  type OnboardingService,
} from '@/services/onboarding/onboarding-service';
import { expoPlatform, type Platform } from '@/services/platform/expo-platform';

export type BootErrorKind = Exclude<OpenResult['status'], 'ready'> | 'unexpected';

export type Services = Readonly<{
  repos: Repositories;
  onboarding: OnboardingService;
  attachments: AttachmentService;
  platform: Platform;
  device: DeviceDefaults;
}>;

type Ready = {
  status: 'ready';
  services: Services;
  settings: Settings;
  i18n: I18n;
  /** True when a language change needs an app reload to flip layout direction. */
  restartRequired: boolean;
  /** Bumped after every write so screens re-read (J2: "update instantly"). */
  version: number;
};

export type BootState =
  { status: 'opening'; i18n: I18n } | { status: 'error'; kind: BootErrorKind; i18n: I18n } | Ready;

type BootStore = BootState & {
  boot: (deps?: OpenDeps, platform?: Platform) => Promise<void>;
  updateSetting: <K extends SettingKey>(key: K, value: Settings[K]) => void;
  bump: () => void;
};

export function readDeviceDefaults(): DeviceDefaults {
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
    set({ ...next, boot: get().boot, updateSetting: get().updateSetting, bump: get().bump }, true);

  return {
    status: 'opening',
    i18n: createI18n(readDeviceDefaults().locale),

    async boot(deps = expoOpenDeps, platform = expoPlatform) {
      transition({ status: 'opening', i18n: get().i18n });
      try {
        const result = await openEncryptedDatabase(deps);
        if (result.status !== 'ready') {
          transition({ status: 'error', kind: result.status, i18n: get().i18n });
          return;
        }
        const device = readDeviceDefaults();
        const newId = createIdFactory(platform.randomBytes);
        const data = { db: result.connection.db, sql: result.connection.sql, now: Date.now, newId };
        // Wall-clock zone is read per call: travelling users get the right "today".
        const repos = createRepositories({
          ...data,
          timeZone: () => readDeviceDefaults().timeZone,
        });
        if (result.createdKey) {
          repos.settings.set('locale', device.locale);
          repos.settings.set('baseCurrency', device.baseCurrency);
          repos.settings.set('firstDayOfWeek', device.firstDayOfWeek);
        }
        const attachments = createAttachmentService({
          repo: repos.attachments,
          files: platform.files,
          compress: platform.compress,
          key: result.attachmentKey,
          randomBytes: platform.randomBytes,
          newId,
        });
        runMaintenance(repos, attachments);
        const settings = repos.settings.getAll();
        applyDirection(settings.locale);
        transition({
          status: 'ready',
          services: {
            repos,
            onboarding: createOnboardingService({ ...data, repos }),
            attachments,
            platform,
            device,
          },
          settings,
          i18n: createI18n(settings.locale),
          restartRequired: false,
          version: 0,
        });
      } catch {
        // No details: errors here may carry SQL or paths. Crash reporting is opt-in (Phase 5).
        transition({ status: 'error', kind: 'unexpected', i18n: get().i18n });
      }
    },

    updateSetting(key, value) {
      const state = get();
      if (state.status !== 'ready') return;
      state.services.repos.settings.set(key, value);
      const settings = state.services.repos.settings.getAll();
      const patch: Partial<Ready> = { settings, version: state.version + 1 };
      if (key === 'locale') {
        patch.i18n = createI18n(settings.locale);
        patch.restartRequired = applyDirection(settings.locale);
      }
      set(patch);
    },

    bump() {
      const state = get();
      if (state.status !== 'ready') return;
      set({ version: state.version + 1, settings: state.services.repos.settings.getAll() });
    },
  };
});

/** Trash retention (30 days) and crash leftovers. Best effort: never blocks startup. */
function runMaintenance(repos: Repositories, attachments: AttachmentService) {
  try {
    const { filePaths } = repos.transactions.purgeExpired();
    attachments.deleteFiles(filePaths);
    attachments.sweepOrphans();
  } catch {
    // retried on next launch
  }
}
