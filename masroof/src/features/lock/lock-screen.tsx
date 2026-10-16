import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeDigits, PIN_MAX, PIN_MIN } from '@/domain';
import { Banner, Button, PinPad, spacing, Text, useTheme } from '@/ui';

import { useSession } from '../session/session';
import { useFormat } from '../session/use-format';
import { PinSetup } from '../security/pin-setup';

type Mode = 'pin' | 'forgot' | 'newPin';

function formatWait(
  ms: number,
  t: (k: 'security.seconds' | 'security.minutes', o: { n: string }) => string,
  digits: (n: number) => string,
) {
  const s = Math.ceil(ms / 1000);
  return s >= 60
    ? t('security.minutes', { n: digits(Math.ceil(s / 60)) })
    : t('security.seconds', { n: digits(s) });
}

/** J8. Shown over the app until a correct PIN or biometric unlock. */
export function LockScreen({
  onUnlocked,
  onReset,
}: {
  onUnlocked: () => void;
  onReset: () => void;
}) {
  const session = useSession();
  const { lock, security } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [mode, setMode] = useState<Mode>('pin');
  const tried = useRef(false);

  // Count the cool-down down once per second.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1000)), 1000);
    return () => clearInterval(id);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function biometric(then: 'unlock' | 'newPin') {
    const r = await lock.unlockWithBiometrics();
    if (r.status === 'ok') {
      if (then === 'unlock') onUnlocked();
      else setMode('newPin');
    } else if (r.status === 'invalidated') {
      setMessage({ tone: 'warning', text: t('lock.biometricsInvalidated') });
      await session.refreshSecurity();
    }
  }

  // Offer biometrics straight away (once).
  useEffect(() => {
    if (security.biometricsEnabled && !tried.current) {
      tried.current = true;
      void biometric('unlock');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [security.biometricsEnabled]);

  // Show an existing cool-down immediately (e.g. app restarted mid-penalty).
  useEffect(() => {
    void lock.status().then((s) => setCooldown(s.cooldownMs));
  }, [lock]);

  async function submit() {
    const r = await lock.verifyPin(normalizeDigits(pin));
    setPin('');
    if (r.status === 'ok') return onUnlocked();
    if (r.status === 'cooldown') return setCooldown(r.cooldownMs);
    if (r.status === 'wrong') {
      setCooldown(r.cooldownMs);
      setMessage(
        r.cooldownMs > 0
          ? null
          : { tone: 'danger', text: t('lock.wrong', { count: f.digits(r.attemptsLeft) }) },
      );
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} testID="lock-screen">
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, alignItems: 'stretch' }}
      >
        <Text variant="display" accessibilityRole="header" style={{ textAlign: 'center' }}>
          🔒 {t('lock.title')}
        </Text>

        {mode === 'pin' ? (
          <>
            <Text style={{ textAlign: 'center' }}>{t('lock.enterPin')}</Text>
            <PinPad
              length={pin.length}
              maxLength={PIN_MAX}
              disabled={cooldown > 0}
              onDigit={(d) => setPin((p) => p + d)}
              onDelete={() => setPin((p) => p.slice(0, -1))}
              arabicDigits={f.arabicDigits}
              labels={{
                entered: t('lock.pinDigit', { n: pin.length, total: PIN_MAX }),
                delete: t('lock.deleteDigit'),
              }}
            />
            {cooldown > 0 ? (
              <Banner
                tone="warning"
                testID="lock-cooldown"
                message={t('lock.cooldown', { time: formatWait(cooldown, t, f.digits) })}
              />
            ) : message ? (
              <Banner tone={message.tone} message={message.text} testID="lock-message" />
            ) : null}
            <Button
              label={t('common.continue')}
              disabled={pin.length < PIN_MIN || cooldown > 0}
              onPress={() => void submit()}
              testID="lock-submit"
            />
            {security.biometricsEnabled ? (
              <Button
                label={t('lock.useBiometrics')}
                variant="secondary"
                onPress={() => void biometric('unlock')}
                testID="lock-biometric"
              />
            ) : null}
            <Button
              label={t('lock.forgot')}
              variant="secondary"
              onPress={() => setMode('forgot')}
              testID="lock-forgot"
            />
          </>
        ) : null}

        {mode === 'forgot' ? (
          <>
            {security.biometricsEnabled ? (
              <>
                <Text>{t('lock.forgotWithBiometrics')}</Text>
                <Button
                  label={t('lock.useBiometrics')}
                  onPress={() => void biometric('newPin')}
                  testID="forgot-biometric"
                />
              </>
            ) : (
              <>
                <Banner
                  tone="danger"
                  message={t('lock.forgotNoBiometrics')}
                  testID="forgot-no-bio"
                />
                <Button
                  label={t('lock.resetAndRestore')}
                  variant="danger"
                  onPress={onReset}
                  testID="forgot-reset"
                />
              </>
            )}
            <Button label={t('common.back')} variant="secondary" onPress={() => setMode('pin')} />
          </>
        ) : null}

        {mode === 'newPin' ? (
          <PinSetup
            title={t('lock.newPinTitle')}
            onDone={async (newPin) => {
              const e = await lock.resetPinAfterBiometric(newPin);
              if (e === null) onUnlocked();
              else setMode('pin');
            }}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
