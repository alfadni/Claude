import { useTranslation } from 'react-i18next';

import { Button, ErrorState, Screen, Text } from '@/ui';

import type { BootErrorKind } from './boot-store';

/**
 * Shown when the encrypted store cannot be opened. Copy always states that
 * nothing was deleted; destructive recovery (reset / restore) arrives with
 * Phase 2 and always requires explicit confirmation.
 */
export function BootErrorScreen({
  kind,
  onRetry,
  onReset,
}: {
  kind: BootErrorKind;
  onRetry: () => void;
  /** Offered when the data can't be unlocked: reset, then restore from a backup. */
  onReset?: () => void;
}) {
  const { t } = useTranslation();
  const canReset = onReset && (kind === 'key_lost' || kind === 'undecryptable');
  return (
    <Screen>
      <Text variant="display" accessibilityRole="header">
        {t('app.name')}
      </Text>
      <ErrorState
        title={t(`boot.${kind}.title`)}
        body={t(`boot.${kind}.body`)}
        action={{ label: t('common.retry'), onPress: onRetry }}
      />
      {canReset ? (
        <Button
          label={t('lock.resetAndRestore')}
          variant="danger"
          onPress={onReset}
          testID="boot-reset"
        />
      ) : null}
    </Screen>
  );
}
