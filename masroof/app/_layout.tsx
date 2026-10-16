import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BootErrorScreen } from '@/features/boot/boot-error-screen';
import { useBootStore } from '@/features/boot/boot-store';
import { LockScreen } from '@/features/lock/lock-screen';
import { useLockStore } from '@/features/lock/lock-store';
import { PrivacyCover } from '@/features/lock/privacy-cover';
import { OnboardingScreen } from '@/features/onboarding/onboarding-screen';
import '@/features/planning/background-task';
import { PlanningHost } from '@/features/planning/planning-host';
import { ResetScreen } from '@/features/reset/reset-screen';
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
        <Stack.Screen name="security" options={{ title: t('security.title') }} />
        <Stack.Screen name="backup" options={{ title: t('backup.title') }} />
        <Stack.Screen name="data" options={{ title: t('csv.title') }} />
        <Stack.Screen name="reset" options={{ title: t('reset.title') }} />
        <Stack.Screen name="upcoming" options={{ title: t('planning.upcomingTitle') }} />
        <Stack.Screen name="recurring" options={{ title: t('planning.rulesTitle') }} />
        <Stack.Screen name="rule/[id]" options={{ title: t('planning.formTitle') }} />
        <Stack.Screen name="budgets" options={{ title: t('budgets.title') }} />
        <Stack.Screen name="budget/[id]" options={{ title: t('budgets.title') }} />
        <Stack.Screen name="goals" options={{ title: t('goals.title') }} />
        <Stack.Screen name="goal/[id]" options={{ title: t('goals.title') }} />
        <Stack.Screen name="reports" options={{ title: t('reports.title') }} />
        <Stack.Screen name="fx" options={{ title: t('fx.title') }} />
        <Stack.Screen name="currency" options={{ title: t('baseCurrency.title') }} />
        <Stack.Screen name="privacy" options={{ title: t('privacy.title') }} />
      </Stack>
      <UndoHost />
      <PlanningHost />
    </View>
  );
}

/**
 * App lock (J8): locks on cold start when a PIN is set and after the timeout
 * in the background; hides content from screen readers while locked; covers
 * the screen whenever the app is not active (app-switcher snapshot).
 */
function LockGate({ children }: { children: ReactNode }) {
  const state = useBootStore();
  const { locked, covered, onAppState, lockNow, unlock } = useLockStore();
  const [resetting, setResetting] = useState(false);
  const ready = state.status === 'ready' ? state : null;
  const pinSet = ready?.security.pinSet ?? false;
  const timeout = ready?.settings.lockTimeoutSeconds ?? 60;

  useEffect(() => {
    if (pinSet) lockNow();
    // Cold start only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) =>
      onAppState(next, { lockEnabled: pinSet, timeoutSeconds: timeout, now: Date.now() }),
    );
    return () => sub.remove();
  }, [onAppState, pinSet, timeout]);

  if (!ready) return null;
  const showLock = locked && pinSet;
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        importantForAccessibility={showLock ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={showLock}
      >
        {children}
      </View>
      {showLock ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>
          {resetting ? (
            <ResetScreen
              reset={ready.services.reset}
              onDone={ready.services.platform.reloadApp}
              onCancel={() => setResetting(false)}
            />
          ) : (
            <LockScreen onUnlocked={unlock} onReset={() => setResetting(true)} />
          )}
        </View>
      ) : null}
      {covered ? <PrivacyCover label={ready.i18n.t('privacy.hidden')} /> : null}
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
        <LockGate>
          <Navigator />
        </LockGate>
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
  const [resettingFromError, setResettingFromError] = useState(false);

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
            resettingFromError ? (
              <ResetScreen
                reset={(typed) => state.resetWithoutDatabase(typed)}
                onDone={() => {
                  setResettingFromError(false);
                  void state.boot();
                }}
                onCancel={() => setResettingFromError(false)}
              />
            ) : (
              <BootErrorScreen
                kind={state.kind}
                onRetry={() => void state.boot()}
                onReset={() => setResettingFromError(true)}
              />
            )
          ) : (
            <LoadingState label={state.i18n.t('common.loading')} />
          )}
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
