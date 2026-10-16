import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  NUMBER_FORMATS,
  formatMoney,
  parts,
  SEED_CATEGORIES,
  toArabicIndicDigits,
  type FormatOptions,
  type LocalDate,
  type Money,
} from '@/domain';

import { useSession } from './session';

/** i18n keys built at runtime (seed names, error codes) are cast once, here. */
export function tDynamic(t: TFunction, key: string, options?: Record<string, unknown>): string {
  return (t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, options);
}

const SEED_NAMES = new Map(SEED_CATEGORIES.map((s) => [s.seedKey, s.name]));

/** Seeded categories show in the UI language until the user renames them. */
export function localizedCategoryName(
  t: TFunction,
  c: { name: string; seedKey: string | null } | undefined,
): string {
  if (!c) return '';
  if (c.seedKey && SEED_NAMES.get(c.seedKey) === c.name) {
    return tDynamic(t, `categories.seed.${c.seedKey}`);
  }
  return c.name;
}

export function useFormat() {
  const { settings } = useSession();
  const { t } = useTranslation();
  return useMemo(() => {
    const format = NUMBER_FORMATS[settings.numberFormat];
    const arabic = settings.numerals === 'arab';
    const digits = (s: string | number) => (arabic ? toArabicIndicDigits(String(s)) : String(s));
    const base: FormatOptions = { format, numerals: settings.numerals };
    return {
      t,
      decimalSeparator: format.decimalSeparator,
      arabicDigits: arabic,
      digits,
      money: (m: Money, options: FormatOptions = {}) => formatMoney(m, { ...base, ...options }),
      date(d: LocalDate): string {
        const { year, month, day } = parts(d);
        return t('dates.dayMonthYear', {
          day: digits(day),
          month: tDynamic(t, `months.${month}`),
          year: digits(year),
        });
      },
      monthYear(d: LocalDate): string {
        const { year, month } = parts(d);
        return t('dates.monthYear', { month: tDynamic(t, `months.${month}`), year: digits(year) });
      },
      categoryName: (c: { name: string; seedKey: string | null } | undefined) =>
        localizedCategoryName(t, c),
      error: (code: string) => tDynamic(t, `errors.${code}`),
      warning: (code: string) => tDynamic(t, `warnings.${code}`),
    };
  }, [settings.numberFormat, settings.numerals, t]);
}

export type Formatter = ReturnType<typeof useFormat>;
