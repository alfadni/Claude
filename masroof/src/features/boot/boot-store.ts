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
import { createBackupService, type BackupService } from '@/services/backup/backup-service';
import { exportTransactionsCsv } from '@/services/csv/export';
import { createCsvImporter, type CsvImporter } from '@/services/csv/import';
import { deviceDefaults, type DeviceDefaults } from '@/services/locale/device-defaults';
import { resetAllData, type ResetResult } from '@/services/reset/reset-service';
import { createLockService, type LockService } from '@/services/security/lock-service';
import {
  createOnboardingService,
  type OnboardingService,
} from '@/services/onboarding/onboarding-service';
import type { NotificationPermission } from '@/services/notifications/notifications';
import {
  createPlanningService,
  type PlanningRun,
  type PlanningService,
} from '@/services/planning/planning-service';
import { expoPlatform, type Platform } from '@/services/platform/expo-platform';

import { planningTexts } from '../planning/planning-texts';

import type { SecurityState } from '../session/session';

export type { SecurityState };

export type BootErrorKind = Exclude<OpenResult['status'], 'ready'> | 'unexpected';

export type Services = Readonly<{
  repos: Repositories;
  onboarding: OnboardingService;
  attachments: AttachmentService;
  lock: LockService;
  backup: BackupService;
  csv: CsvImporter;
  /** Wipes everything (J11). Only callable with the typed confirmation word. */
  reset: (typed: string) => Promise<ResetResult>;
  exportCsv: (categoryName: (c: { name: string; seedKey: string | null }) => string) => string;
  platform: Platform;
  device: DeviceDefaults;
  planning: PlanningService;
}>;

export type PlanningState = Readonly<{
  permission: NotificationPermission;
  /** Last foreground run, shown once on Home ("rent recorded", J5). */
  notice: PlanningRun | null;
  /** Local date of the last engine run, to re-run on a new day. */
  lastRunOn: string | null;
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
  security: SecurityState;
  planning: PlanningState;
};

export type BootState =
  { status: 'opening'; i18n: I18n } | { status: 'error'; kind: BootErrorKind; i18n: I18n } | Ready;

type BootStore = BootState & {
  boot: (deps?: OpenDeps, platform?: Platform) => Promise<void>;
  updateSetting: <K extends SettingKey>(key: K, value: Settings[K]) => void;
  bump: () => void;
  refreshSecurity: () => Promise<void>;
  /** Run the recurrence engine + budget alerts (app open, new day). */
  runPlanning: () => Promise<void>;
  /** Ask for notification permission in context (first rule or budget). */
  requestNotifications: () => Promise<NotificationPermission>;
  dismissPlanningNotice: () => void;
  /** J11 from the "key lost" boot error: no database is open, so only files and keys are wiped. */
  resetWithoutDatabase: (typed: string, platform?: Platform) => Promise<ResetResult>;
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
    set(
      {
        ...next,
        boot: get().boot,
        updateSetting: get().updateSetting,
        bump: get().bump,
        refreshSecurity: get().refreshSecurity,
        resetWithoutDatabase: get().resetWithoutDatabase,
        runPlanning: get().runPlanning,
        requestNotifications: get().requestNotifications,
        dismissPlanningNotice: get().dismissPlanningNotice,
      },
      true,
    );

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
        const i18n = createI18n(settings.locale);
        const lock = createLockService({
          secrets: platform.secrets,
          vault: platform.vault(() => i18n.t('lock.biometricPrompt')),
          randomBytes: platform.randomBytes,
          now: Date.now,
        });
        const services: Services = {
          repos,
          onboarding: createOnboardingService({ ...data, repos }),
          attachments,
          lock,
          backup: createBackupService({
            sql: data.sql,
            attachments: repos.attachments,
            files: platform.files,
            attachmentKey: result.attachmentKey,
            randomBytes: platform.randomBytes,
            now: Date.now,
            appVersion: platform.appVersion,
            openScratch: platform.openScratch,
          }),
          csv: createCsvImporter({ ...data, repos }),
          exportCsv: (categoryName) => exportTransactionsCsv(data.sql, categoryName),
          reset: (typed) =>
            resetAllData(
              {
                ...platform.resetPorts(() => result.connection.close()),
                wipeLock: () => lock.wipe(),
                cancelNotifications: () => platform.notifications.cancelAll(),
              },
              typed,
            ),
          platform,
          device,
          planning: createPlanningService({
            ...data,
            repos,
            notifications: platform.notifications,
            // Read the live instance: the language can change after boot.
            texts: () => {
              const s = get();
              return planningTexts((s.status === 'ready' ? s.i18n : i18n).t, repos);
            },
            timeZone: () => readDeviceDefaults().timeZone,
          }),
        };
        transition({
          status: 'ready',
          services,
          settings,
          i18n,
          restartRequired: false,
          version: 0,
          security: await readSecurity(lock, platform),
          planning: {
            permission: await platform.notifications.status(),
            notice: null,
            lastRunOn: null,
          },
        });
        await get().runPlanning();
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
      // Every write passes through here: check budget thresholds (J2, J6). Best effort.
      void state.services.planning.afterWrite().catch(() => undefined);
    },

    async runPlanning() {
      const state = get();
      if (state.status !== 'ready') return;
      const { planning, repos } = state.services;
      // Nothing to plan before onboarding finishes.
      if (state.settings.onboardingStep !== 'done') return;
      try {
        const run = await planning.run({ background: false });
        const permission = await planning.permission();
        const now = get();
        if (now.status !== 'ready') return;
        const changed = run.posted + run.pending > 0;
        set({
          version: now.version + (changed ? 1 : 0),
          planning: {
            permission,
            notice: changed ? run : now.planning.notice,
            lastRunOn: repos.today(),
          },
        });
      } catch {
        // Retried on the next open; the engine is idempotent.
      }
    },

    async requestNotifications() {
      const state = get();
      if (state.status !== 'ready') return 'denied';
      const permission = await state.services.planning.ensurePermission();
      const now = get();
      if (now.status === 'ready') set({ planning: { ...now.planning, permission } });
      if (permission === 'granted') void state.services.planning.refreshReminders();
      return permission;
    },

    dismissPlanningNotice() {
      const state = get();
      if (state.status !== 'ready') return;
      set({ planning: { ...state.planning, notice: null } });
    },

    async resetWithoutDatabase(typed, platform = expoPlatform) {
      const lock = createLockService({
        secrets: platform.secrets,
        vault: platform.vault(() => ''),
        randomBytes: platform.randomBytes,
        now: Date.now,
      });
      return resetAllData(
        {
          ...platform.resetPorts(() => undefined),
          wipeLock: () => lock.wipe(),
          cancelNotifications: () => platform.notifications.cancelAll(),
        },
        typed,
      );
    },

    async refreshSecurity() {
      const state = get();
      if (state.status !== 'ready') return;
      const security = await readSecurity(state.services.lock, state.services.platform);
      set({ security, version: state.version + 1 });
    },
  };
});

async function readSecurity(lock: LockService, platform: Platform): Promise<SecurityState> {
  const [s, compromised] = await Promise.all([lock.status(), platform.isDeviceCompromised()]);
  return {
    pinSet: s.pinSet,
    biometricsEnabled: s.biometricsEnabled,
    biometricsAvailable: s.biometricsAvailable,
    compromised,
  };
}

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
