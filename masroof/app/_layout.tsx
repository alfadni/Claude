import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BootErrorScreen } from '@/features/boot/boot-error-screen';
import { useBootStore } from '@/features/boot/boot-store';
import { LoadingState, ThemeProvider, useTheme } from '@/ui';

function Navigator() {
  const { colors, scheme } = useTheme();
  const i18n = useBootStore((s) => s.i18n);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: i18n.t('home.title') }} />
        <Stack.Screen name="settings" options={{ title: i18n.t('settings.title') }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const state = useBootStore();

  useEffect(() => {
    void useBootStore.getState().boot();
  }, []);

  const theme = state.status === 'ready' ? state.settings.theme : 'system';

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={state.i18n}>
        <ThemeProvider preference={theme}>
          {state.status === 'ready' ? (
            <Navigator />
          ) : state.status === 'error' ? (
            <BootErrorScreen kind={state.kind} onRetry={() => void state.boot()} />
          ) : (
            <LoadingState label={state.i18n.t('common.loading')} />
          )}
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
