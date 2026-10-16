import { useState } from 'react';

import { isWeakPin, normalizeDigits, PIN_MAX, PIN_MIN } from '@/domain';
import { Banner, Button, PinPad, Stack, Text } from '@/ui';

import { useFormat } from '../session/use-format';

/** Enter a new PIN twice. Weak PINs (1111, 1234) are warned about, not forbidden. */
export function PinSetup({ onDone, title }: { onDone: (pin: string) => void; title?: string }) {
  const f = useFormat();
  const { t } = f;
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [weakPending, setWeakPending] = useState(false);
  const stage = first === null ? 'enter' : 'confirm';

  function submit() {
    const p = normalizeDigits(pin);
    if (stage === 'enter') {
      if (isWeakPin(p) && !weakPending) {
        setWeakPending(true);
        return;
      }
      setFirst(p);
      setPin('');
      setWeakPending(false);
      return;
    }
    if (p !== first) {
      setError(t('security.mismatch'));
      setFirst(null);
      setPin('');
      return;
    }
    onDone(p);
  }

  return (
    <Stack gap="md" testID="pin-setup">
      <Text variant="title" accessibilityRole="header">
        {title ?? (stage === 'enter' ? t('security.enterNew') : t('security.confirmNew'))}
      </Text>
      {title ? (
        <Text tone="muted">
          {stage === 'enter' ? t('security.enterNew') : t('security.confirmNew')}
        </Text>
      ) : null}
      <PinPad
        length={pin.length}
        maxLength={PIN_MAX}
        onDigit={(d) => {
          setError(null);
          setWeakPending(false);
          setPin((p) => p + d);
        }}
        onDelete={() => setPin((p) => p.slice(0, -1))}
        arabicDigits={f.arabicDigits}
        labels={{
          entered: t('lock.pinDigit', { n: pin.length, total: PIN_MAX }),
          delete: t('lock.deleteDigit'),
        }}
      />
      {error ? <Banner tone="danger" message={error} testID="pin-mismatch" /> : null}
      {weakPending ? (
        <Banner tone="warning" message={t('security.weak')} testID="pin-weak" />
      ) : null}
      <Button
        label={weakPending ? t('security.keepAnyway') : t('common.continue')}
        disabled={pin.length < PIN_MIN}
        onPress={submit}
        testID="pin-continue"
      />
    </Stack>
  );
}
