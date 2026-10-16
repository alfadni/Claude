import { isCurrencyCode, isValidTimeZone, type CurrencyCode, type Weekday } from '@/domain';
import { DEFAULT_SETTINGS, type Locale } from '@/domain/settings';
import { resolveLocale } from '@/i18n';

/** What the OS tells us (shape of expo-localization's first locale/calendar). */
export type DeviceLocaleInfo = Readonly<{
  languageTag?: string | null;
  currencyCode?: string | null;
  /** Gregorian weekday as reported by expo-localization: 1 = Sunday … 7 = Saturday. */
  firstWeekday?: number | null;
  timeZone?: string | null;
}>;

export type DeviceDefaults = Readonly<{
  locale: Locale;
  baseCurrency: CurrencyCode;
  firstDayOfWeek: Weekday;
  timeZone: string;
}>;

/**
 * Defaults for the "user skips onboarding" path (J1). Every field falls back
 * to a safe constant when the OS reports nothing or something unexpected.
 */
export function deviceDefaults(info: DeviceLocaleInfo): DeviceDefaults {
  const currency = info.currencyCode?.toUpperCase() ?? '';
  const fw = info.firstWeekday;
  const tz = info.timeZone ?? '';
  return {
    locale: resolveLocale(info.languageTag),
    baseCurrency: isCurrencyCode(currency) ? currency : DEFAULT_SETTINGS.baseCurrency,
    firstDayOfWeek:
      typeof fw === 'number' && Number.isInteger(fw) && fw >= 1 && fw <= 7
        ? ((fw - 1) as Weekday)
        : DEFAULT_SETTINGS.firstDayOfWeek,
    timeZone: tz !== '' && isValidTimeZone(tz) ? tz : 'UTC',
  };
}
