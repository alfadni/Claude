import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BootErrorScreen } from '@/features/boot/boot-error-screen';
import { useBootStore } from '@/features/boot/boot-store';
import { OnboardingScreen } from '@/features/onboarding/onboarding-screen';
import { SessionHost } from '@/features/session/session-host';
import { UndoHost } from '@/features/undo/undo-host';
import { restartForDirection } from '@/i18n/direction';
import { Banner, LoadingState, ThemeProvider, useTheme } from '@/ui';

function Navigator() {
  const { colors, scheme } = useTheme();
  const i18n = useBootStore((s) => s.i18n);
  const t = i18n.t.bind(i18n);
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
          headerBackTitle: t('common.back'),
        }}
      >
        <Stack.Screen name="index" options={{ title: t('app.name') }} />
        <Stack.Screen
          name="add"
          options={{ title: t('quickAdd.titleNew'), presentation: 'modal' }}
        />
        <Stack.Screen name="transactions" options={{ title: t('transactions.title') }} />
        <Stack.Screen name="transaction/[id]" options={{ title: t('detail.title') }} />
        <Stack.Screen name="accounts" options={{ title: t('accounts.title') }} />
        <Stack.Screen name="account/[id]" options={{ title: t('accounts.editTitle') }} />
        <Stack.Screen name="categories" options={{ title: t('categories.title') }} />
        <Stack.Screen name="trash" options={{ title: t('trash.title') }} />
        <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
      </Stack>
      <UndoHost />
    </View>
  );
}

function ReadyApp() {
  const state = useBootStore();
  if (state.status !== 'ready') return null;
  const onboardingDone = state.services.onboarding.screen() === 'done';
  return (
    <SessionHost>
      {onboardingDone ? (
        <Navigator />
      ) : (
        <View style={{ flex: 1 }}>
          {state.restartRequired ? (
            <Banner
              tone="warning"
              message={state.i18n.t('settings.restartBody')}
              action={{
                label: state.i18n.t('settings.restartNow'),
                onPress: () => void restartForDirection(),
              }}
            />
          ) : null}
          <OnboardingScreen
            device={state.services.device}
            onLanguageChosen={(l) => state.updateSetting('locale', l)}
            onFinished={state.bump}
          />
        </View>
      )}
    </SessionHost>
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
            <ReadyApp />
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
