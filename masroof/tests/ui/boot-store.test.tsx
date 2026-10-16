import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { addDays } from '@/domain';
import { silentNotifications } from '@/services/notifications/notifications';

import type { AppDatabase } from '@/data/database';
import { schema } from '@/data/schema';
import { useBootStore } from '@/features/boot/boot-store';
import type { OpenDeps, SecretStore } from '@/services/db/open-database';
import type { Platform } from '@/services/platform/expo-platform';

import { FakeVault, MemorySecrets } from '../helpers/security';
import { betterSqliteExecutor, seededBytes } from '../helpers/sqlite';

jest.mock('@/services/db/expo-connection', () => ({ expoOpenDeps: {} }));
jest.mock('@/services/platform/expo-platform', () => ({ expoPlatform: {} }));
jest.mock('expo', () => ({ ...jest.requireActual('expo'), reloadAppAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n).map((_, i) => (i * 37 + 11) % 256),
}));
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'ar-SD', currencyCode: 'SDG' }],
  getCalendars: () => [{ firstWeekday: 7, timeZone: 'Africa/Khartoum' }],
}));

function memorySecrets(): SecretStore {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
}

const platform: Platform = {
  files: {
    write: async () => undefined,
    read: async () => new Uint8Array(),
    move: () => undefined,
    delete: () => undefined,
    list: () => [],
    availableBytes: () => 1e9,
  },
  compress: async () => new Uint8Array([1]),
  pickImage: async () => ({ status: 'cancelled' }),
  randomBytes: (n) => new Uint8Array(n).map((_, i) => (i * 31 + 7) % 256),
  openSystemSettings: () => undefined,
  haptic: () => undefined,
  secrets: new MemorySecrets(),
  vault: () => new FakeVault(),
  isDeviceCompromised: async () => false,
  shareBytes: async () => undefined,
  pickFile: async () => null,
  openScratch: () => betterSqliteExecutor(new Database(':memory:')),
  resetPorts: () => ({
    closeDatabase: () => undefined,
    deleteDatabaseFile: () => undefined,
    deleteAppFiles: () => undefined,
    deleteDatabaseKey: async () => undefined,
  }),
  reloadApp: () => undefined,
  appVersion: 'test',
  notifications: silentNotifications,
};

function plainDeps(raw = new Database(':memory:'), secrets = memorySecrets()): OpenDeps {
  return {
    secrets,
    randomBytes: seededBytes(5),
    requireCipher: false,
    openConnection: () => ({
      sql: betterSqliteExecutor(raw),
      db: drizzle(raw, { schema }) as unknown as AppDatabase,
      cipherVersion: () => null,
      close: () => undefined,
    }),
  };
}

describe('boot store', () => {
  it('fresh install: opens the DB and seeds settings from the device (J1 skip path)', async () => {
    await useBootStore.getState().boot(plainDeps(), platform);
    const s = useBootStore.getState();
    expect(s.status).toBe('ready');
    if (s.status !== 'ready') return;
    expect(s.settings).toMatchObject({ locale: 'ar', baseCurrency: 'SDG', firstDayOfWeek: 6 });
    expect(s.i18n.t('home.addFirst')).toBe('أضف أول مصروف');
  });

  it("second launch keeps the user's settings rather than re-seeding", async () => {
    const raw = new Database(':memory:');
    const secrets = memorySecrets();
    await useBootStore.getState().boot(plainDeps(raw, secrets), platform);
    useBootStore.getState().updateSetting('baseCurrency', 'USD');
    await useBootStore.getState().boot(plainDeps(raw, secrets), platform);
    const s = useBootStore.getState();
    expect(s.status === 'ready' && s.settings.baseCurrency).toBe('USD');
  });

  it('switching language rebuilds translations', async () => {
    await useBootStore.getState().boot(plainDeps(), platform);
    useBootStore.getState().updateSetting('locale', 'en');
    const s = useBootStore.getState();
    expect(s.status === 'ready' && s.i18n.t('home.addFirst')).toBe('Add your first expense');
  });

  it('maps open failures to an error state', async () => {
    const deps = { ...plainDeps(), requireCipher: true };
    await useBootStore.getState().boot(deps, platform);
    expect(useBootStore.getState()).toMatchObject({ status: 'error', kind: 'cipher_unavailable' });
  });

  it('unexpected exceptions become a generic error with no details', async () => {
    await useBootStore.getState().boot(plainDeps(), platform); // a previous ready session
    const deps: OpenDeps = {
      ...plainDeps(),
      openConnection: () => {
        throw new Error('SQLITE_CANTOPEN /private/path');
      },
    };
    await useBootStore.getState().boot(deps, platform);
    const s = useBootStore.getState();
    expect(s).toMatchObject({ status: 'error', kind: 'unexpected' });
    // No stale session survives, and no error detail leaks into state.
    expect(Object.keys(s).sort()).toEqual([
      'boot',
      'bump',
      'dismissPlanningNotice',
      'i18n',
      'kind',
      'refreshSecurity',
      'requestNotifications',
      'resetWithoutDatabase',
      'runPlanning',
      'status',
      'updateSetting',
    ]);
    expect(JSON.stringify({ status: s.status, kind: 'kind' in s ? s.kind : null })).not.toContain(
      '/private/path',
    );
  });

  it('J5/J2: the engine runs on open, and every write checks budget thresholds', async () => {
    const raw = new Database(':memory:');
    const secrets = memorySecrets();
    await useBootStore.getState().boot(plainDeps(raw, secrets), platform);
    let s = useBootStore.getState();
    if (s.status !== 'ready') throw new Error('not ready');
    const { repos } = s.services;
    repos.settings.set('onboardingStep', 'done');
    const account = repos.accounts.create({
      name: 'Cash',
      type: 'cash',
      currency: 'SDG',
      openingBalanceMinor: 0,
      openedOn: null,
      includeInTotals: true,
    });
    repos.categories.seedDefaults();
    const food = repos.categories.list('expense').find((c) => c.seedKey === 'food');
    if (!account.ok || !food) throw new Error('setup failed');
    const today = repos.today();
    const tx = repos.transactions.create({
      type: 'expense',
      accountId: account.value.id,
      amountMinor: 1000,
      occurredAt: Date.now(),
      occurredTz: 'Africa/Khartoum',
      occurredOn: addDays(today, -1),
      splits: [{ categoryId: food.id, amountMinor: 1000 }],
    });
    if (!tx.ok) throw new Error('tx failed');
    repos.recurring.createFromTransaction(tx.value.id, {
      pattern: { frequency: 'daily', interval: 1 },
      mode: 'auto_post',
    });
    // Next launch: yesterday's daily rule posts today's occurrence.
    await useBootStore.getState().boot(plainDeps(raw, secrets), platform);
    s = useBootStore.getState();
    if (s.status !== 'ready') throw new Error('not ready');
    expect(s.planning.notice).toMatchObject({ posted: 1, pending: 0 });
    expect(s.planning.lastRunOn).toBe(today);

    const r2 = s.services.repos;
    r2.budgets.create({
      categoryId: food.id,
      period: 'monthly',
      amountMinor: 2500,
      rollover: false,
      thresholds: [80],
    });
    useBootStore.getState().bump();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sent = r2.budgets.statuses().flatMap((b) => b.evaluation?.reached ?? []);
    expect(sent).toEqual([80]);
    expect(raw.prepare('SELECT threshold FROM budget_alerts_sent').all()).toEqual([
      { threshold: 80 },
    ]);
  });

  it('ignores setting updates before the DB is ready', () => {
    useBootStore.setState({ status: 'opening' });
    expect(() => useBootStore.getState().updateSetting('theme', 'dark')).not.toThrow();
  });
});
