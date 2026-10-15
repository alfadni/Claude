import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Locale, ThemePreference } from '@/domain/settings';
import { createI18n } from '@/i18n';
import { ThemeProvider } from '@/ui';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export async function renderWithProviders(
  ui: ReactElement,
  opts: { locale?: Locale; theme?: ThemePreference } = {},
) {
  const i18n = createI18n(opts.locale ?? 'en');
  return {
    i18n,
    ...(await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider preference={opts.theme ?? 'light'}>{ui}</ThemeProvider>
        </I18nextProvider>
      </SafeAreaProvider>,
    )),
  };
}
