import { isCurrencyCode, type CurrencyCode } from './money/currency';
import { NUMBER_FORMATS, type NumberFormatId, type Numerals } from './money/format';
import type { Weekday } from './time/local-date';

export type Locale = 'en' | 'ar';
export type ThemePreference = 'light' | 'dark' | 'system';

export type Settings = {
  locale: Locale;
  baseCurrency: CurrencyCode;
  firstDayOfWeek: Weekday;
  numberFormat: NumberFormatId;
  numerals: Numerals;
  theme: ThemePreference;
  /** Seconds in background before the app locks (spec §7 default 60). */
  lockTimeoutSeconds: number;
  /** Last completed onboarding step, so a killed app resumes (J1). */
  onboardingStep: 'none' | 'language' | 'currency' | 'account' | 'security' | 'done';
  /** Quick add defaults to the last account used (spec §5.3). */
  lastAccountId: string | null;
  /** Epoch ms of the last encrypted backup, for backup reminders (spec 5.14). */
  lastBackupAt: number | null;
};

export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  locale: 'en',
  baseCurrency: 'USD',
  firstDayOfWeek: 1,
  numberFormat: 'en',
  numerals: 'latn',
  theme: 'system',
  lockTimeoutSeconds: 60,
  onboardingStep: 'none',
  lastAccountId: null,
  lastBackupAt: null,
});

const oneOf =
  <T extends string | number>(values: readonly T[]) =>
  (v: unknown): v is T =>
    values.includes(v as T);

/** Runtime validators: stored JSON is untrusted (restore, CSV, future sync). */
export const SETTING_VALIDATORS: { [K in SettingKey]: (v: unknown) => v is Settings[K] } = {
  locale: oneOf<Locale>(['en', 'ar']),
  baseCurrency: (v): v is CurrencyCode => typeof v === 'string' && isCurrencyCode(v),
  firstDayOfWeek: oneOf<Weekday>([0, 1, 2, 3, 4, 5, 6]),
  numberFormat: (v): v is NumberFormatId => typeof v === 'string' && v in NUMBER_FORMATS,
  numerals: oneOf<Numerals>(['latn', 'arab']),
  theme: oneOf<ThemePreference>(['light', 'dark', 'system']),
  lockTimeoutSeconds: (v): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3600,
  onboardingStep: oneOf<Settings['onboardingStep']>([
    'none',
    'language',
    'currency',
    'account',
    'security',
    'done',
  ]),
  lastAccountId: (v): v is string | null =>
    v === null || (typeof v === 'string' && v.length > 0 && v.length <= 64),
  lastBackupAt: (v): v is number | null =>
    v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v > 0),
};

/** Remind after 30 days without a backup (or never), once there is data to lose. */
export const BACKUP_REMINDER_MS = 30 * 24 * 60 * 60 * 1000;
export function backupOverdue(lastBackupAt: number | null, now: number, hasData: boolean): boolean {
  if (!hasData) return false;
  return lastBackupAt === null || now - lastBackupAt > BACKUP_REMINDER_MS;
}

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_VALIDATORS;
}
