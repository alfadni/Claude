import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { Repositories } from '@/data/repositories';
import type { SettingKey, Settings } from '@/domain/settings';
import type { AttachmentService } from '@/services/attachments/attachment-service';
import type { PickResult } from '@/services/attachments/expo-ports';
import type { BackupService } from '@/services/backup/backup-service';
import type { CsvImporter } from '@/services/csv/import';
import type { OnboardingService } from '@/services/onboarding/onboarding-service';
import type { PickedFile } from '@/services/platform/expo-data-io';
import type { ResetResult } from '@/services/reset/reset-service';
import type { LockService } from '@/services/security/lock-service';

export type SecurityState = Readonly<{
  pinSet: boolean;
  biometricsEnabled: boolean;
  biometricsAvailable: boolean;
  compromised: boolean;
}>;

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
  lock: LockService;
  security: SecurityState;
  refreshSecurity: () => Promise<void>;
  backup: BackupService;
  csv: CsvImporter;
  reset: (typed: string) => Promise<ResetResult>;
  /** Plain-text CSV of all transactions (the UI warns before sharing it). */
  exportCsv: (categoryName: (c: { name: string; seedKey: string | null }) => string) => string;
  shareBytes: (fileName: string, bytes: Uint8Array | string, mimeType: string) => Promise<void>;
  pickFile: (mimeTypes: string[]) => Promise<PickedFile | null>;
  reloadApp: () => void;
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
