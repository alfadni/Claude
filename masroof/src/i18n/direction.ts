import { reloadAppAsync } from 'expo';
import { I18nManager } from 'react-native';

import type { Locale } from '@/domain/settings';

import { isRtlLocale } from './index';

/**
 * React Native fixes layout direction at startup, so switching between EN and
 * AR needs a reload. Call on boot (with the stored locale) and after the user
 * changes language. Returns true if a reload is needed for the change to apply.
 */
export function applyDirection(locale: Locale): boolean {
  const wantRtl = isRtlLocale(locale);
  I18nManager.allowRTL(wantRtl);
  I18nManager.forceRTL(wantRtl);
  return I18nManager.isRTL !== wantRtl;
}

export function restartForDirection(): Promise<void> {
  return reloadAppAsync('layout direction changed');
}
