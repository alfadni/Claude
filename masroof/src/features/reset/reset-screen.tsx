import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ResetResult } from '@/services/reset/reset-service';
import { RESET_WORD } from '@/services/reset/reset-service';
import { Banner, Button, spacing, Text, TextField } from '@/ui';

/**
 * J11. Prop-driven (no session) so it also works from the lock screen and from
 * the "key lost" boot error, where no database is open.
 */
export function ResetScreen({
  reset,
  onBackup,
  onDone,
  onCancel,
}: {
  reset: (typed: string) => Promise<ResetResult>;
  onBackup?: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const matches = typed.trim() === RESET_WORD;
  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
      testID="reset-screen"
    >
      <Text variant="title" tone="danger" accessibilityRole="header">
        {t('reset.title')}
      </Text>
      <Banner tone="danger" message={t('reset.body')} />
      {onBackup ? (
        <Button label={t('reset.backupFirst')} onPress={onBackup} testID="reset-backup-first" />
      ) : null}
      <TextField
        label={t('reset.typeToConfirm', { word: RESET_WORD })}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        testID="reset-input"
      />
      {failed ? <Banner tone="danger" message={t('reset.failed')} /> : null}
      <Button
        label={t('reset.confirm')}
        variant="danger"
        disabled={!matches || busy}
        testID="reset-confirm"
        onPress={async () => {
          setBusy(true);
          const r = await reset(typed);
          setBusy(false);
          if (r === 'done') onDone();
          else setFailed(true);
        }}
      />
      <Button
        label={t('common.cancel')}
        variant="secondary"
        onPress={onCancel}
        testID="reset-cancel"
      />
    </ScrollView>
  );
}
