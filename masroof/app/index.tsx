import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, EmptyState, Screen, Text } from '@/ui';

/**
 * Phase 0 shell. The calendar home (baseline strength) and quick add land in
 * Phase 1; this screen proves boot, theming, i18n and RTL end to end.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  return (
    <Screen scroll>
      <Text variant="display" accessibilityRole="header">
        {t('app.name')}
      </Text>
      <Text tone="muted">{t('app.tagline')}</Text>
      <EmptyState title={t('home.emptyTitle')} body={t('home.emptyBody')} />
      <Button label={t('home.addFirst')} disabled accessibilityHint={t('home.comingSoon')} />
      <Text tone="muted" variant="caption">
        {t('home.comingSoon')}
      </Text>
      <Link href="/settings" asChild>
        <Button label={t('settings.title')} variant="secondary" />
      </Link>
    </Screen>
  );
}
