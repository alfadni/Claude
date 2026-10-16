import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Locale } from '@/domain/settings';
import { SessionProvider, type Session } from '@/features/session/session';
import { createI18n } from '@/i18n';
import { createAttachmentService, type AddResult } from '@/services/attachments/attachment-service';
import type { PickResult } from '@/services/attachments/expo-ports';
import { deriveKey } from '@/services/crypto/aead';
import { createOnboardingService } from '@/services/onboarding/onboarding-service';
import { ThemeProvider } from '@/ui';

import { createLedger, type Ledger } from '../helpers/ledger';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export type TestSession = {
  ledger: Ledger;
  session: Session;
  pick: jest.Mock<Promise<PickResult>, ['library' | 'camera']>;
  openSettings: jest.Mock;
  bumps: () => number;
  addResult: { next: AddResult['status'] | null };
};

export function createTestSession(options: { locale?: Locale; ledger?: Ledger } = {}): TestSession {
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
  const holder: { session: Session } = {} as { session: Session };
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
  };
  holder.session = session;
  return { ledger, session, pick, openSettings, bumps: () => bumpCount, addResult };
}

export async function renderWithSession(ui: ReactElement, ts: TestSession, locale: Locale = 'en') {
  const i18n = createI18n(locale);
  const wrap = (node: ReactElement) => (
    <SafeAreaProvider initialMetrics={metrics}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider preference="light">
          <SessionProvider
            value={{ ...ts.session, settings: ts.session.settings, version: ts.bumps() }}
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
