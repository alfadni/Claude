import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ListRow, spacing, useTheme } from '@/ui';

import { useLedger, useSession } from '../session/session';
import { tDynamic, useFormat } from '../session/use-format';
import { ruleLabel } from './planning-texts';
import { scheduleText } from './schedule-text';

/** All recurring rules with their schedule, mode and next date. */
export function RecurringListScreen({ onOpen }: { onOpen: (ruleId: string) => void }) {
  const { repos } = useSession();
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const { rules } = useLedger((r) => r.recurring.list(), []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} testID="rules">
        {rules.length === 0 ? (
          <EmptyState title={t('planning.rulesTitle')} body={t('planning.rulesEmpty')} />
        ) : (
          rules.map((r) => {
            const state = r.isPaused
              ? t('planning.paused')
              : r.nextOn
                ? t('planning.next', { date: f.date(r.nextOn) })
                : t('planning.ended');
            const subtitle = [
              scheduleText(t, f, r.schedule),
              tDynamic(t, `planning.mode_${r.mode}`),
              state,
            ].join(' · ');
            return (
              <ListRow
                key={r.id}
                icon={r.isPaused ? '⏸' : '🔁'}
                title={ruleLabel(t, repos, r)}
                subtitle={subtitle}
                onPress={() => onOpen(r.id)}
                accessibilityLabel={`${ruleLabel(t, repos, r)}, ${subtitle}`}
                testID={`rule-${r.id}`}
              />
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
