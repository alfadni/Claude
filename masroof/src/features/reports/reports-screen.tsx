import { useState } from 'react';
import { I18nManager, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { money, monthOf, next, parts, previous, type Period } from '@/domain';
import {
  Button,
  Card,
  ColumnChart,
  EmptyState,
  HBar,
  ProgressBar,
  Row,
  sharePercent,
  spacing,
  Stack,
  Text,
  useTheme,
} from '@/ui';

import { useLedger, useSession } from '../session/session';
import { useFormat } from '../session/use-format';

const TREND_MONTHS = 12;
const TOP_PAYEES = 5;
const COMPARISON_ROWS = 8;

/** Reports & insights (spec 5.12, ADR-016). All amounts in the base currency. */
export function ReportsScreen() {
  const { repos, settings } = useSession();
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const today = repos.today();
  const [month, setMonth] = useState<Period>(() => monthOf(today));
  const currency = settings.baseCurrency;
  const m = (minor: number) => f.money(money(minor, currency));

  const totals = useLedger((r) => r.reports.periodTotals(month, today), [month, today]);
  const trend = useLedger(
    (r) => r.reports.monthlyTotals(month, TREND_MONTHS, today),
    [month, today],
  );
  const breakdown = useLedger((r) => r.reports.categoryTotals(month, 'expense'), [month]);
  const comparison = useLedger(
    (r) => r.reports.categoryComparison(month, 'expense', today),
    [month, today],
  );
  const payees = useLedger((r) => r.reports.topPayees(month, TOP_PAYEES, today), [month, today]);
  const goals = useLedger((r) => r.goals.statuses(today), [today]);
  const categories = useLedger((r) => r.categories.list(undefined, { includeArchived: true }), []);
  const catName = (id: string) => f.categoryName(categories.find((c) => c.id === id));
  const [prevGlyph, nextGlyph] = I18nManager.isRTL ? ['›', '‹'] : ['‹', '›'];

  const income = totals.incomeMinor;
  const spent = totals.spentSoFarMinor;
  const maxIE = Math.max(income, spent);
  const maxPayee = Math.max(0, ...payees.map((p) => p.totalMinor));
  const hasData = income > 0 || spent > 0 || trend.some((x) => x.incomeMinor + x.expenseMinor > 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} testID="reports">
        <Row gap="sm" style={{ justifyContent: 'space-between' }}>
          <Button
            label={prevGlyph}
            variant="secondary"
            accessibilityLabel={t('home.previousMonth')}
            onPress={() => setMonth(previous(month))}
            testID="reports-prev"
          />
          <Text variant="title" accessibilityRole="header" testID="reports-month">
            {f.monthYear(month.start)}
          </Text>
          <Button
            label={nextGlyph}
            variant="secondary"
            accessibilityLabel={t('home.nextMonth')}
            onPress={() => setMonth(next(month))}
            testID="reports-next"
          />
        </Row>

        {!hasData ? <EmptyState title={t('reports.title')} body={t('reports.noData')} /> : null}

        <Card testID="income-vs-expense">
          <Text variant="bodyStrong" accessibilityRole="header">
            {t('reports.incomeVsExpense')}
          </Text>
          <HBar
            label={`▲ ${t('home.tabIncome')}`}
            valueText={m(income)}
            percent={sharePercent(income, maxIE)}
            tone="income"
            accessibilityLabel={t('amount.income', { amount: m(income) })}
          />
          <HBar
            label={`▼ ${t('home.spentSoFar')}`}
            valueText={m(spent)}
            percent={sharePercent(spent, maxIE)}
            tone="expense"
            accessibilityLabel={t('amount.expense', { amount: m(spent) })}
          />
          <Text testID="reports-net">{t('reports.net', { amount: m(income - spent) })}</Text>
        </Card>

        <Card>
          <Text variant="bodyStrong" accessibilityRole="header">
            {t('reports.trend')}
          </Text>
          <ColumnChart
            testID="trend"
            groups={trend.map((x) => ({
              key: x.month,
              // Month number: compact and correct in every language (the full name is spoken).
              label: f.digits(parts(x.month).month),
              accessibilityLabel: t('reports.trendLabel', {
                month: f.monthYear(x.month),
                income: m(x.incomeMinor),
                expense: m(x.expenseMinor),
              }),
              bars: [
                { value: x.incomeMinor, tone: 'income' },
                { value: x.expenseMinor, tone: 'expense' },
              ],
            }))}
          />
        </Card>

        {breakdown.length > 0 ? (
          <Card testID="breakdown">
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('reports.breakdown')}
            </Text>
            {breakdown.map((c) => {
              const percent = Math.round(c.share * 100);
              return (
                <HBar
                  key={c.categoryId}
                  label={catName(c.categoryId)}
                  valueText={`${m(c.totalMinor)} · ${f.digits(percent)}%`}
                  percent={percent}
                  tone="expense"
                  accessibilityLabel={t('home.categoryShare', {
                    name: catName(c.categoryId),
                    amount: m(c.totalMinor),
                    percent: f.digits(percent),
                  })}
                />
              );
            })}
          </Card>
        ) : null}

        {comparison.length > 0 ? (
          <Card testID="comparison">
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('reports.comparison')}
            </Text>
            {comparison.slice(0, COMPARISON_ROWS).map((c) => {
              const delta =
                c.deltaMinor > 0
                  ? `▲ ${t('reports.more', { amount: m(c.deltaMinor) })}`
                  : c.deltaMinor < 0
                    ? `▼ ${t('reports.less', { amount: m(-c.deltaMinor) })}`
                    : t('reports.same');
              return (
                <Row
                  key={c.categoryId}
                  gap="sm"
                  accessible
                  accessibilityLabel={`${t('reports.comparisonLabel', {
                    name: catName(c.categoryId),
                    current: m(c.currentMinor),
                    previous: m(c.previousMinor),
                  })}. ${delta}`}
                  style={{ justifyContent: 'space-between' }}
                  testID={`delta-${c.categoryId}`}
                >
                  <Text style={{ flex: 1 }} numberOfLines={1}>
                    {catName(c.categoryId)}
                  </Text>
                  <Text tone={c.deltaMinor > 0 ? 'expense' : c.deltaMinor < 0 ? 'income' : 'muted'}>
                    {delta}
                  </Text>
                </Row>
              );
            })}
          </Card>
        ) : null}

        {payees.length > 0 ? (
          <Card testID="payees">
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('reports.topPayees')}
            </Text>
            {payees.map((p, i) => (
              <HBar
                key={p.name}
                label={`${f.digits(i + 1)}. ${p.name}`}
                valueText={m(p.totalMinor)}
                percent={sharePercent(p.totalMinor, maxPayee)}
                tone="expense"
                accessibilityLabel={`${p.name}: ${m(p.totalMinor)}, ${t('reports.payeeCount', {
                  count: f.digits(p.count),
                })}`}
              />
            ))}
          </Card>
        ) : null}

        {goals.length > 0 ? (
          <Card testID="report-goals">
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('reports.goals')}
            </Text>
            {goals.map(({ goal, progress }) =>
              progress ? (
                <Stack key={goal.id} gap="xxs">
                  <Text>{goal.name}</Text>
                  <ProgressBar
                    percent={progress.percent}
                    tone={progress.status === 'reached' ? 'ok' : 'neutral'}
                    label={`${goal.name}: ${f.digits(progress.percent)}%`}
                  />
                </Stack>
              ) : null,
            )}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
