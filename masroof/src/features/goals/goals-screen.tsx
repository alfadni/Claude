import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { money, type CurrencyCode } from '@/domain';
import { Button, Card, EmptyState, ProgressBar, Row, spacing, Stack, Text, useTheme } from '@/ui';

import { useLedger, useSession } from '../session/session';
import { useFormat } from '../session/use-format';

/** Savings goals with progress from the linked account (spec 5.12). */
export function GoalsScreen({
  onOpen,
  onAdd,
}: {
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const { repos } = useSession();
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const today = repos.today();
  const statuses = useLedger((r) => r.goals.statuses(today), [today]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} testID="goals">
        {statuses.length === 0 ? (
          <EmptyState
            title={t('goals.title')}
            body={t('goals.empty')}
            action={{ label: t('goals.add'), onPress: onAdd }}
          />
        ) : (
          <>
            {statuses.map(({ goal, progress: p, accountName, missingRate }) => {
              const m = (minor: number) => f.money(money(minor, goal.currency as CurrencyCode));
              const status = !p
                ? null
                : p.status === 'reached'
                  ? `✓ ${t('goals.reached')}`
                  : p.status === 'overdue'
                    ? `⚠ ${t('goals.overdue')}`
                    : p.status === 'no_date'
                      ? t('goals.noDate')
                      : t('goals.by', { date: f.date(goal.targetDate as never) });
              return (
                <Card key={goal.id} testID={`goal-${goal.id}`}>
                  <Pressable accessibilityRole="button" onPress={() => onOpen(goal.id)}>
                    <Stack gap="xs">
                      <Row gap="sm" style={{ justifyContent: 'space-between' }}>
                        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                          {goal.name}
                        </Text>
                        {status ? (
                          <Text tone={p?.status === 'overdue' ? 'warning' : 'muted'}>{status}</Text>
                        ) : null}
                      </Row>
                      {accountName ? (
                        <Text variant="caption" tone="muted">
                          {accountName}
                        </Text>
                      ) : null}
                      {missingRate || !p ? (
                        <Text tone="muted">{t('goals.missingRate')}</Text>
                      ) : (
                        <>
                          <ProgressBar
                            percent={p.percent}
                            tone={p.status === 'reached' ? 'ok' : 'neutral'}
                            label={`${goal.name}: ${t('goals.progress', {
                              saved: m(p.savedMinor),
                              target: m(p.targetMinor),
                            })}`}
                          />
                          <Text variant="caption">
                            {t('goals.progress', {
                              saved: m(p.savedMinor),
                              target: m(p.targetMinor),
                            })}
                          </Text>
                          {p.monthlyNeededMinor !== null ? (
                            <Text variant="caption" testID={`goal-monthly-${goal.id}`}>
                              {t('goals.monthlyNeeded', { amount: m(p.monthlyNeededMinor) })}
                            </Text>
                          ) : null}
                        </>
                      )}
                    </Stack>
                  </Pressable>
                </Card>
              );
            })}
            <Button label={t('goals.add')} variant="secondary" onPress={onAdd} testID="goal-add" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
