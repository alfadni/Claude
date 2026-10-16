import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Chip, spacing, Stack, Text, useTheme } from '@/ui';

import { useSession } from '../session/session';
import { useFormat } from '../session/use-format';

const POINTS = ['device', 'network', 'notifications', 'backups', 'deletion'] as const;

/** What the app does with data, and the only network switch it has (ADR-017). */
export function PrivacyScreen() {
  const session = useSession();
  const { t } = useFormat();
  const { colors } = useTheme();
  const on = session.settings.crashReports;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} testID="privacy">
        <Text>{t('privacy.intro')}</Text>
        <Card>
          <Stack gap="sm">
            {POINTS.map((p) => (
              <Text key={p}>• {t(`privacy.points.${p}`)}</Text>
            ))}
          </Stack>
        </Card>
        <Card>
          <Text variant="bodyStrong">{t('privacy.crashTitle')}</Text>
          <Text tone="muted">{t('privacy.crashBody')}</Text>
          {session.crashReportsAvailable ? (
            <Chip
              role="checkbox"
              label={t('privacy.crashTitle')}
              selected={on}
              onPress={() => session.updateSetting('crashReports', !on)}
              testID="crash-toggle"
            />
          ) : (
            <Text tone="muted" testID="crash-unavailable">
              {t('privacy.crashUnavailable')}
            </Text>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
