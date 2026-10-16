import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CurrencyCode } from '@/domain';
import type { Locale } from '@/domain/settings';
import { SUPPORTED_LOCALES } from '@/i18n';
import type { DeviceDefaults } from '@/services/locale/device-defaults';
import { Banner, Button, Chip, spacing, Stack, Text, TextField, useTheme } from '@/ui';

import { CurrencyPicker } from '../accounts/currency-picker';
import { PinSetup } from '../security/pin-setup';
import { useSession } from '../session/session';
import { useFormat } from '../session/use-format';

/**
 * J1: language → base currency → first account. Each step commits atomically
 * (see onboarding-service), so a killed app resumes where it left off.
 */
export function OnboardingScreen({
  device,
  onLanguageChosen,
  onFinished,
}: {
  device: DeviceDefaults;
  /** Applies the language (and RTL) immediately; may require a restart. */
  onLanguageChosen: (locale: Locale) => void;
  onFinished: () => void;
}) {
  const session = useSession();
  const { onboarding, settings } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const screen = onboarding.screen();
  const [currency, setCurrency] = useState<CurrencyCode>(device.baseCurrency);
  const [accountName, setAccountName] = useState('');
  const [sample, setSample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinDone, setPinDone] = useState(false);
  const finish = () => {
    onboarding.finishSecurity();
    session.bump();
    onFinished();
  };

  const advance = () => session.bump();
  const skip = (
    <Button
      label={t('onboarding.skipAll')}
      variant="secondary"
      testID="skip-all"
      onPress={() => {
        onboarding.skipAll(device, t('onboarding.defaultCashName'));
        session.bump();
        onFinished();
      }}
    />
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        testID={`onboarding-${screen}`}
      >
        <Text variant="display" accessibilityRole="header">
          {t('app.name')}
        </Text>
        <Text tone="muted">{t('app.tagline')}</Text>

        {screen === 'language' ? (
          <Stack gap="md">
            <Text variant="title" accessibilityRole="header">
              {t('onboarding.languageTitle')}
            </Text>
            {SUPPORTED_LOCALES.map((l) => (
              <Chip
                key={l}
                label={t(`languages.${l}`)}
                selected={settings.locale === l}
                testID={`lang-${l}`}
                onPress={() => {
                  onboarding.chooseLanguage(l);
                  onLanguageChosen(l);
                  advance();
                }}
              />
            ))}
            {skip}
          </Stack>
        ) : null}

        {screen === 'currency' ? (
          <Stack gap="md">
            <Text variant="title" accessibilityRole="header">
              {t('onboarding.currencyTitle')}
            </Text>
            <Text tone="muted">{t('onboarding.currencyBody')}</Text>
            <CurrencyPicker
              value={currency}
              onChange={setCurrency}
              label={t('onboarding.currencyTitle')}
              searchLabel={t('onboarding.currencySearch')}
              preferred={device.baseCurrency}
            />
            <Button
              label={t('common.continue')}
              testID="currency-continue"
              onPress={() => {
                onboarding.chooseCurrency(currency);
                advance();
              }}
            />
            {skip}
          </Stack>
        ) : null}

        {screen === 'account' ? (
          <Stack gap="md">
            <Text variant="title" accessibilityRole="header">
              {t('onboarding.accountTitle')}
            </Text>
            <Text tone="muted">{t('onboarding.accountBody')}</Text>
            <TextField
              label={t('onboarding.accountName')}
              value={accountName}
              placeholder={t('onboarding.defaultCashName')}
              onChangeText={setAccountName}
              maxLength={40}
              testID="first-account-name"
            />
            <Chip
              role="checkbox"
              label={t('onboarding.sampleData')}
              selected={sample}
              onPress={() => setSample(!sample)}
            />
            {error ? <Banner tone="danger" message={error} /> : null}
            <Button
              label={t('onboarding.start')}
              testID="onboarding-start"
              onPress={() => {
                const r = onboarding.createFirstAccount(
                  accountName.trim() || t('onboarding.defaultCashName'),
                );
                if (!r.ok) return setError(r.error.map((e) => f.error(e)).join('\n'));
                if (sample) {
                  onboarding.loadSampleData(session.timeZone, {
                    note: (k) =>
                      `${t('onboarding.sampleData')}: ${f.categoryName({ name: '', seedKey: k })}`,
                  });
                }
                advance();
              }}
            />
            {skip}
          </Stack>
        ) : null}

        {screen === 'security' ? (
          <Stack gap="md">
            <Text variant="title" accessibilityRole="header">
              {t('security.title')}
            </Text>
            <Text tone="muted">{t('security.intro')}</Text>
            {pinDone ? (
              <>
                {session.security.biometricsAvailable ? (
                  <Chip
                    role="checkbox"
                    label={t('security.biometrics')}
                    selected={session.security.biometricsEnabled}
                    testID="onboarding-biometrics"
                    onPress={async () => {
                      if (session.security.biometricsEnabled)
                        await session.lock.disableBiometrics();
                      else await session.lock.enableBiometrics();
                      await session.refreshSecurity();
                    }}
                  />
                ) : null}
                <Banner tone="warning" message={t('security.forgotWarning')} />
                <Button label={t('onboarding.start')} testID="onboarding-finish" onPress={finish} />
              </>
            ) : (
              <>
                <PinSetup
                  onDone={async (pin) => {
                    await session.lock.setPin(pin);
                    await session.refreshSecurity();
                    setPinDone(true);
                  }}
                />
                <Button
                  label={t('common.skip')}
                  variant="secondary"
                  testID="security-skip"
                  onPress={finish}
                />
              </>
            )}
          </Stack>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
