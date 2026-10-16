import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BudgetStatus } from '@/data/repositories/budgets-repository';
import { lastDay, money, type BudgetTone } from '@/domain';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Row,
  spacing,
  Stack,
  Text,
  useTheme,
} from '@/ui';

import { budgetLabel } from '../planning/planning-texts';
import { useLedger, useSession } from '../session/session';
import { tDynamic, useFormat, type Formatter } from '../session/use-format';

export const TONE_ICON: Record<BudgetTone, string> = { ok: '✓', warning: '⚠', over: '⛔' };

/** One budget's health: bar + status as text and icon (never colour alone). */
export function BudgetCard({
  status,
  f,
  onPress,
  compact = false,
}: {
  status: BudgetStatus;
  f: Formatter;
  onPress?: () => void;
  compact?: boolean;
}) {
  const { repos, settings } = useSession();
  const { t } = f;
  const { budget, evaluation: e } = status;
  const name = budgetLabel(t, repos, budget.categoryId);
  const m = (minor: number) => f.money(money(minor, settings.baseCurrency));
  const body = (
    <Stack gap="xs">
      <Row gap="sm" style={{ justifyContent: 'space-between' }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {name}
          {budget.period === 'weekly' ? ` · ${t('budgets.weekly')}` : ''}
        </Text>
        {e ? (
          <Text tone={e.tone === 'ok' ? 'income' : e.tone === 'warning' ? 'warning' : 'danger'}>
            {TONE_ICON[e.tone]} {tDynamic(t, `budgets.tone_${e.tone}`)}
          </Text>
        ) : null}
      </Row>
      {status.missingRate || !e ? (
        <Text tone="muted">{t('budgets.missingRate')}</Text>
      ) : (
        <>
          <ProgressBar
            percent={e.percent}
            tone={e.tone}
            label={t('budgets.progressLabel', {
              name,
              percent: f.digits(e.percent),
              status: tDynamic(t, `budgets.tone_${e.tone}`),
            })}
            testID={`budget-bar-${budget.id}`}
          />
          <Row gap="sm" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Text variant="caption">
              {t('budgets.spentOf', { spent: m(e.spentMinor), limit: m(e.limitMinor) })}
            </Text>
            <Text variant="caption" tone={e.remainingMinor < 0 ? 'danger' : 'muted'}>
              {e.remainingMinor < 0
                ? t('budgets.over', { amount: m(-e.remainingMinor) })
                : t('budgets.left', { amount: m(e.remainingMinor) })}
            </Text>
          </Row>
          {!compact && status.phase === 'active' ? (
            <Text variant="caption" testID={`safe-${budget.id}`}>
              {t('budgets.safeToSpend', { amount: m(e.safeToSpendTodayMinor) })}
            </Text>
          ) : null}
          {!compact && e.scheduledMinor > 0 ? (
            <Text variant="caption" tone="muted">
              {t('budgets.scheduled', { amount: m(e.scheduledMinor) })}
            </Text>
          ) : null}
          {status.phase === 'upcoming' ? (
            <Text variant="caption" tone="muted">
              {t('budgets.upcomingPeriod', { date: f.date(status.period.start) })}
            </Text>
          ) : null}
          {status.phase === 'ended' ? (
            <Text variant="caption" tone="muted">
              {t('budgets.endedPeriod', { date: f.date(lastDay(status.period)) })}
            </Text>
          ) : null}
        </>
      )}
      {!compact && status.categoryArchived ? (
        <Banner
          tone="warning"
          message={t('budgets.archivedCategory')}
          testID={`archived-${budget.id}`}
        />
      ) : null}
    </Stack>
  );
  return (
    <Card testID={`budget-${budget.id}`}>
      {onPress ? (
        <Pressable accessibilityRole="button" onPress={onPress}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </Card>
  );
}

export function BudgetsScreen({
  onOpen,
  onAdd,
}: {
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const session = useSession();
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const today = session.repos.today();
  const statuses = useLedger((r) => r.budgets.statuses(today), [today]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} testID="budgets">
        {session.notificationPermission === 'denied' && statuses.length > 0 ? (
          <Banner
            tone="info"
            message={t('planning.notificationsOff')}
            action={{ label: t('planning.openSettings'), onPress: session.openSystemSettings }}
            testID="notifications-off"
          />
        ) : null}
        {statuses.length === 0 ? (
          <EmptyState
            title={t('budgets.title')}
            body={t('budgets.empty')}
            action={{ label: t('budgets.add'), onPress: onAdd }}
          />
        ) : (
          <>
            {statuses.map((s) => (
              <BudgetCard key={s.budget.id} status={s} f={f} onPress={() => onOpen(s.budget.id)} />
            ))}
            <Button
              label={t('budgets.add')}
              variant="secondary"
              onPress={onAdd}
              testID="budget-add"
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
