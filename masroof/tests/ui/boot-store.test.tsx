import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDatabase } from '@/data/database';
import { schema } from '@/data/schema';
import { useBootStore } from '@/features/boot/boot-store';
import type { OpenDeps, SecretStore } from '@/services/db/open-database';

import { betterSqliteExecutor, seededBytes } from '../helpers/sqlite';

jest.mock('@/services/db/expo-connection', () => ({ expoOpenDeps: {} }));
jest.mock('expo', () => ({ reloadAppAsync: jest.fn() }));
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
    await useBootStore.getState().boot(plainDeps());
    const s = useBootStore.getState();
    expect(s.status).toBe('ready');
    if (s.status !== 'ready') return;
    expect(s.settings).toMatchObject({ locale: 'ar', baseCurrency: 'SDG', firstDayOfWeek: 6 });
    expect(s.i18n.t('home.addFirst')).toBe('أضف أول مصروف');
  });

  it("second launch keeps the user's settings rather than re-seeding", async () => {
    const raw = new Database(':memory:');
    const secrets = memorySecrets();
    await useBootStore.getState().boot(plainDeps(raw, secrets));
    useBootStore.getState().updateSetting('baseCurrency', 'USD');
    await useBootStore.getState().boot(plainDeps(raw, secrets));
    const s = useBootStore.getState();
    expect(s.status === 'ready' && s.settings.baseCurrency).toBe('USD');
  });

  it('switching language rebuilds translations', async () => {
    await useBootStore.getState().boot(plainDeps());
    useBootStore.getState().updateSetting('locale', 'en');
    const s = useBootStore.getState();
    expect(s.status === 'ready' && s.i18n.t('home.addFirst')).toBe('Add your first expense');
  });

  it('maps open failures to an error state', async () => {
    const deps = { ...plainDeps(), requireCipher: true };
    await useBootStore.getState().boot(deps);
    expect(useBootStore.getState()).toMatchObject({ status: 'error', kind: 'cipher_unavailable' });
  });

  it('unexpected exceptions become a generic error with no details', async () => {
    await useBootStore.getState().boot(plainDeps()); // a previous ready session
    const deps: OpenDeps = {
      ...plainDeps(),
      openConnection: () => {
        throw new Error('SQLITE_CANTOPEN /private/path');
      },
    };
    await useBootStore.getState().boot(deps);
    const s = useBootStore.getState();
    expect(s).toMatchObject({ status: 'error', kind: 'unexpected' });
    // No stale session survives, and no error detail leaks into state.
    expect(Object.keys(s).sort()).toEqual(['boot', 'i18n', 'kind', 'status', 'updateSetting']);
    expect(JSON.stringify({ status: s.status, kind: 'kind' in s ? s.kind : null })).not.toContain(
      '/private/path',
    );
  });

  it('ignores setting updates before the DB is ready', () => {
    useBootStore.setState({ status: 'opening' });
    expect(() => useBootStore.getState().updateSetting('theme', 'dark')).not.toThrow();
  });
});
