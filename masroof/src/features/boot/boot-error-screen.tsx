import { useTranslation } from 'react-i18next';

import { ErrorState, Screen, Text } from '@/ui';

import type { BootErrorKind } from './boot-store';

/**
 * Shown when the encrypted store cannot be opened. Copy always states that
 * nothing was deleted; destructive recovery (reset / restore) arrives with
 * Phase 2 and always requires explicit confirmation.
 */
export function BootErrorScreen({ kind, onRetry }: { kind: BootErrorKind; onRetry: () => void }) {
  const { t } = useTranslation();
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
    </Screen>
  );
}
