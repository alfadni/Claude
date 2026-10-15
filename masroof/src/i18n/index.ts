import { createInstance, type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

import type { Locale } from '@/domain/settings';

import { ar } from './locales/ar';
import { en } from './locales/en';

export const resources = { en: { translation: en }, ar: { translation: ar } } as const;

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'ar'];

export function isRtlLocale(locale: Locale): boolean {
  return locale === 'ar';
}

/** Map any BCP-47 tag ("ar-SD", "en-GB", "fr") to a supported locale. */
export function resolveLocale(tag: string | null | undefined): Locale {
  const lang = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return lang === 'ar' ? 'ar' : 'en';
}

export function createI18n(locale: Locale): I18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    initAsync: false, // resources are bundled: init synchronously
    interpolation: { escapeValue: false }, // React escapes
    returnNull: false,
  });
  return instance;
}

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: (typeof resources)['en'];
  }
}
