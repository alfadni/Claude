import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LOCK_TIMEOUT_CHOICES, normalizeDigits, PIN_MAX, PIN_MIN } from '@/domain';
import { Banner, Button, Card, Chip, PinPad, Row, spacing, Stack, Text, useTheme } from '@/ui';

import { useSession } from '../session/session';
import { useFormat } from '../session/use-format';
import { useUndoStore } from '../undo/undo-store';
import { PinSetup } from './pin-setup';

type Flow = null | 'set' | 'verify-change' | 'verify-off';

/** Spec 7 / J8: PIN, biometrics, auto-lock timeout. Changing or removing the lock needs the current PIN. */
export function SecurityScreen({ onBackup }: { onBackup: () => void }) {
  const session = useSession();
  const { lock, security, settings } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const toast = useUndoStore((s) => s.show);
  const [flow, setFlow] = useState<Flow>(null);
  const [current, setCurrent] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function afterVerify() {
    const r = await lock.verifyPin(normalizeDigits(current));
    setCurrent('');
    if (r.status !== 'ok') {
      setError(
        r.status === 'wrong'
          ? t('lock.wrong', { count: f.digits(r.attemptsLeft) })
          : t('lock.cooldown', { time: '…' }),
      );
      return;
    }
    setError(null);
    if (flow === 'verify-off') {
      await lock.disableLock();
      await session.refreshSecurity();
      setFlow(null);
    } else setFlow('set');
  }

  const timeoutLabel = (s: number) =>
    s === 0
      ? t('security.immediately')
      : s < 60
        ? t('security.seconds', { n: f.digits(s) })
        : t('security.minutes', { n: f.digits(s / 60) });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        testID="security-screen"
      >
        <Text tone="muted">{t('security.intro')}</Text>
        {security.compromised ? (
          <Banner tone="warning" message={t('security.compromised')} testID="compromised" />
        ) : null}

        {flow === 'set' ? (
          <PinSetup
            onDone={async (pin) => {
              await lock.setPin(pin);
              await session.refreshSecurity();
              setFlow(null);
              toast(t('security.pinSaved'));
            }}
          />
        ) : flow === 'verify-change' || flow === 'verify-off' ? (
          <Stack gap="md">
            <Text variant="title">{t('security.confirmCurrent')}</Text>
            <PinPad
              length={current.length}
              maxLength={PIN_MAX}
              onDigit={(d) => setCurrent((c) => c + d)}
              onDelete={() => setCurrent((c) => c.slice(0, -1))}
              arabicDigits={f.arabicDigits}
              labels={{
                entered: t('lock.pinDigit', { n: current.length, total: PIN_MAX }),
                delete: t('lock.deleteDigit'),
              }}
            />
            {error ? <Banner tone="danger" message={error} /> : null}
            <Button
              label={t('common.continue')}
              disabled={current.length < PIN_MIN}
              onPress={() => void afterVerify()}
              testID="verify-current"
            />
            <Button label={t('common.cancel')} variant="secondary" onPress={() => setFlow(null)} />
          </Stack>
        ) : (
          <Card>
            {!security.pinSet ? (
              <Button
                label={t('security.setPin')}
                onPress={() => setFlow('set')}
                testID="set-pin"
              />
            ) : (
              <>
                <Button
                  label={t('security.changePin')}
                  variant="secondary"
                  onPress={() => setFlow('verify-change')}
                  testID="change-pin"
                />
                <Button
                  label={t('security.turnOff')}
                  variant="danger"
                  onPress={() => setFlow('verify-off')}
                  testID="turn-off"
                />
              </>
            )}
            {security.pinSet && security.biometricsAvailable ? (
              <Chip
                role="checkbox"
                label={t('security.biometrics')}
                selected={security.biometricsEnabled}
                testID="biometrics-toggle"
                onPress={async () => {
                  if (security.biometricsEnabled) await lock.disableBiometrics();
                  else await lock.enableBiometrics();
                  await session.refreshSecurity();
                }}
              />
            ) : security.pinSet ? (
              <Text tone="muted" variant="caption">
                {t('security.biometricsUnavailable')}
              </Text>
            ) : null}
          </Card>
        )}

        {security.pinSet ? (
          <Card>
            <Text variant="bodyStrong">{t('security.lockAfter')}</Text>
            <Row gap="sm" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
              {LOCK_TIMEOUT_CHOICES.map((s) => (
                <Chip
                  key={s}
                  label={timeoutLabel(s)}
                  selected={settings.lockTimeoutSeconds === s}
                  onPress={() => session.updateSetting('lockTimeoutSeconds', s)}
                />
              ))}
            </Row>
          </Card>
        ) : null}

        {security.pinSet && !security.biometricsEnabled ? (
          <Banner
            tone="warning"
            message={t('security.forgotWarning')}
            action={{ label: t('security.makeBackup'), onPress: onBackup }}
            testID="forgot-warning"
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
