import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Locale } from '@/domain/settings';
import { SessionProvider, type Session, type SecurityState } from '@/features/session/session';
import { createI18n } from '@/i18n';
import { createAttachmentService, type AddResult } from '@/services/attachments/attachment-service';
import type { PickResult } from '@/services/attachments/expo-ports';
import { deriveKey } from '@/services/crypto/aead';
import Database from 'better-sqlite3';

import { createBackupService } from '@/services/backup/backup-service';
import { exportTransactionsCsv } from '@/services/csv/export';
import { createCsvImporter } from '@/services/csv/import';
import type { NotificationPermission } from '@/services/notifications/notifications';
import { createOnboardingService } from '@/services/onboarding/onboarding-service';
import { createPlanningService, type PlanningRun } from '@/services/planning/planning-service';
import type { PickedFile } from '@/services/platform/expo-data-io';
import type { ResetResult } from '@/services/reset/reset-service';
import { createLockService } from '@/services/security/lock-service';

import { FakeVault, MemorySecrets, rnd, TEST_KDF } from '../helpers/security';
import { betterSqliteExecutor } from '../helpers/sqlite';
import { MemoryFiles } from '../helpers/backup';
import { ThemeProvider } from '@/ui';

import { createLedger, TZ, type Ledger } from '../helpers/ledger';
import { fakeNotifications, testTexts, type FakeNotifications } from '../helpers/planning';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export type TestSession = {
  ledger: Ledger;
  session: Session;
  vault: FakeVault;
  secrets: MemorySecrets;
  security: { current: SecurityState };
  share: jest.Mock<Promise<void>, [string, Uint8Array | string, string]>;
  pickFileMock: jest.Mock<Promise<PickedFile | null>, [string[]]>;
  resetMock: jest.Mock<Promise<ResetResult>, [string]>;
  reload: jest.Mock;
  pick: jest.Mock<Promise<PickResult>, ['library' | 'camera']>;
  openSettings: jest.Mock;
  bumps: () => number;
  addResult: { next: AddResult['status'] | null };
  notifications: FakeNotifications;
  planningNotice: { current: PlanningRun | null };
};

export function createTestSession(
  options: { locale?: Locale; ledger?: Ledger; permission?: NotificationPermission } = {},
): TestSession {
  const ledger = options.ledger ?? createLedger();
  if (options.locale) ledger.repos.settings.set('locale', options.locale);
  let bumpCount = 0;
  const pick = jest.fn<Promise<PickResult>, ['library' | 'camera']>(async () => ({
    status: 'cancelled',
  }));
  const openSettings = jest.fn();
  const files = new Map<string, Uint8Array>();
  const addResult: { next: AddResult['status'] | null } = { next: null };
  const real = createAttachmentService({
    repo: ledger.repos.attachments,
    files: {
      write: async (p, b) => void files.set(p, b),
      read: async (p) => files.get(p) ?? new Uint8Array(),
      move: (a, b) => {
        const v = files.get(a);
        if (v) files.set(b, v);
        files.delete(a);
      },
      delete: (p) => void files.delete(p),
      list: () => [...files.keys()],
      availableBytes: () => 1e9,
    },
    compress: async () => new Uint8Array([0xff, 0xd8, 1, 2, 3]),
    key: deriveKey(new Uint8Array(32).fill(9), 'attachments/v1'),
    randomBytes: (n) => new Uint8Array(n).map((_, i) => (i * 13 + bumpCount) % 256),
    newId: ledger.newId,
  });
  const attachments = {
    ...real,
    add: async (txId: string, uri: string): Promise<AddResult> => {
      if (addResult.next && addResult.next !== 'ok') return { status: addResult.next } as AddResult;
      return real.add(txId, uri);
    },
  };
  const secrets = new MemorySecrets();
  const vault = new FakeVault();
  const lock = createLockService({
    secrets,
    vault,
    randomBytes: rnd,
    now: () => ledger.clock.now,
    kdf: TEST_KDF,
  });
  const security = {
    current: {
      pinSet: false,
      biometricsEnabled: false,
      biometricsAvailable: true,
      compromised: false,
    } as SecurityState,
  };
  const share = jest.fn<Promise<void>, [string, Uint8Array | string, string]>(
    async () => undefined,
  );
  const pickFileMock = jest.fn<Promise<PickedFile | null>, [string[]]>(async () => null);
  const resetMock = jest.fn<Promise<ResetResult>, [string]>(async () => 'done');
  const reload = jest.fn();
  const backupFiles = new MemoryFiles();
  const holder: { session: Session } = {} as { session: Session };
  const notifications = fakeNotifications(options.permission ?? 'granted');
  const planning = createPlanningService({
    ...ledger,
    repos: ledger.repos,
    notifications,
    texts: () => testTexts,
    timeZone: () => TZ,
  });
  const planningNotice: { current: PlanningRun | null } = { current: null };
  const session: Session = {
    repos: ledger.repos,
    onboarding: createOnboardingService({ ...ledger, repos: ledger.repos }),
    attachments,
    pickImage: pick,
    openSystemSettings: openSettings,
    haptic: () => undefined,
    timeZone: 'Africa/Khartoum',
    get settings() {
      return ledger.repos.settings.getAll();
    },
    get version() {
      return bumpCount;
    },
    bump: () => {
      bumpCount++;
    },
    updateSetting: (k, v) => {
      ledger.repos.settings.set(k, v);
      bumpCount++;
    },
    lock,
    get security() {
      return security.current;
    },
    refreshSecurity: async () => {
      const s = await lock.status();
      security.current = {
        ...security.current,
        pinSet: s.pinSet,
        biometricsEnabled: s.biometricsEnabled,
        biometricsAvailable: s.biometricsAvailable,
      };
      bumpCount++;
    },
    backup: createBackupService({
      sql: ledger.sql,
      attachments: ledger.repos.attachments,
      files: backupFiles,
      attachmentKey: deriveKey(new Uint8Array(32).fill(9), 'attachments/v1'),
      randomBytes: rnd,
      now: () => ledger.clock.now,
      appVersion: 'test',
      openScratch: () => betterSqliteExecutor(new Database(':memory:')),
      kdf: TEST_KDF,
    }),
    csv: createCsvImporter({ ...ledger, repos: ledger.repos }),
    reset: resetMock,
    exportCsv: (name) => exportTransactionsCsv(ledger.sql, name),
    shareBytes: share,
    pickFile: pickFileMock,
    reloadApp: reload,
    planning,
    get notificationPermission() {
      return notifications.permission;
    },
    get planningNotice() {
      return planningNotice.current;
    },
    dismissPlanningNotice: () => {
      planningNotice.current = null;
      bumpCount++;
    },
    requestNotifications: async () => {
      const p = await planning.ensurePermission();
      bumpCount++;
      return p;
    },
  };
  holder.session = session;
  return {
    ledger,
    session,
    pick,
    openSettings,
    bumps: () => bumpCount,
    addResult,
    vault,
    secrets,
    security,
    share,
    pickFileMock,
    resetMock,
    reload,
    notifications,
    planningNotice,
  };
}

export async function renderWithSession(ui: ReactElement, ts: TestSession, locale: Locale = 'en') {
  const i18n = createI18n(locale);
  const wrap = (node: ReactElement) => (
    <SafeAreaProvider initialMetrics={metrics}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider preference="light">
          <SessionProvider
            value={{
              ...ts.session,
              settings: ts.session.settings,
              version: ts.bumps(),
              notificationPermission: ts.session.notificationPermission,
              planningNotice: ts.session.planningNotice,
            }}
          >
            {node}
          </SessionProvider>
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
  const utils = await render(wrap(ui));
  return {
    ...utils,
    i18n,
    /** Re-render with a fresh session snapshot (what the app does after bump()). */
    refresh: () => utils.rerender(wrap(ui)),
  };
}
