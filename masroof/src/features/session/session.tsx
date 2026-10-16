import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { Repositories } from '@/data/repositories';
import type { SettingKey, Settings } from '@/domain/settings';
import type { AttachmentService } from '@/services/attachments/attachment-service';
import type { PickResult } from '@/services/attachments/expo-ports';
import type { OnboardingService } from '@/services/onboarding/onboarding-service';

/** Everything a screen needs, injected so screens are testable with an in-memory ledger. */
export type Session = Readonly<{
  repos: Repositories;
  onboarding: OnboardingService;
  attachments: AttachmentService;
  pickImage: (source: 'library' | 'camera') => Promise<PickResult>;
  openSystemSettings: () => void;
  haptic: (kind: 'success' | 'warning') => void;
  timeZone: string;
  settings: Settings;
  /** Increments after every write so read models recompute (J2: "update instantly"). */
  version: number;
  bump: () => void;
  updateSetting: <K extends SettingKey>(key: K, value: Settings[K]) => void;
}>;

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ value, children }: { value: Session; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/**
 * Run a synchronous repository read, recomputed whenever data changes
 * (`version`) or the caller's inputs change. `deps` are serialised into one key
 * so the dependency list stays a literal; `read` is intentionally not a
 * dependency (callers pass an inline closure over the same `deps`).
 */
export function useLedger<T>(read: (repos: Repositories) => T, deps: readonly unknown[]): T {
  const { repos, version } = useSession();
  const key = JSON.stringify(deps);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => read(repos), [repos, version, key]);
}
