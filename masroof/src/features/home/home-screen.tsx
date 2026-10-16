import { useState } from 'react';
import { I18nManager, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  money,
  monthOf,
  next,
  previous,
  type CategoryKind,
  type LocalDate,
  type Period,
} from '@/domain';
import {
  AmountText,
  Banner,
  Button,
  Card,
  EmptyState,
  Fab,
  Row,
  Segmented,
  Stack,
  Text,
  radius,
  spacing,
  useTheme,
} from '@/ui';

import { useLedger, useSession } from '../session/session';
import { useFormat } from '../session/use-format';
import { MonthCalendar } from './month-calendar';

type Tab = 'income' | 'balance' | 'expense';

export type HomeNav = Readonly<{
  onAdd: (date?: LocalDate) => void;
  onDay: (date: LocalDate) => void;
  onCategory: (categoryId: string, period: Period) => void;
  onAllTransactions: () => void;
  onSettings: () => void;
  onAccounts: () => void;
}>;

export function HomeScreen({ nav }: { nav: HomeNav }) {
  const { repos, settings } = useSession();
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const today = repos.today();
  const [month, setMonth] = useState<Period>(() => monthOf(today));
  const [tab, setTab] = useState<Tab>('expense');
  const currency = settings.baseCurrency;

  const hasAny = useLedger((r) => r.reports.hasAnyTransactions(), []);
  const days = useLedger((r) => r.reports.daySummaries(month), [month]);
  const totals = useLedger((r) => r.reports.periodTotals(month, today), [month, today]);
  const net = useLedger((r) => r.reports.netWorth(today), [today]);
  const kind: CategoryKind = tab === 'income' ? 'income' : 'expense';
  const byCategory = useLedger((r) => r.reports.categoryTotals(month, kind), [month, kind]);
  const categories = useLedger((r) => r.categories.list(undefined, { includeArchived: true }), []);
  const accounts = useLedger((r) => r.accounts.list(), []);
  const balances = useLedger((r) => r.accounts.balances(today), [today]);
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Chevrons point "backwards/forwards" in reading direction.
  const [prevGlyph, nextGlyph] = I18nManager.isRTL ? ['›', '‹'] : ['‹', '›'];
  const m = (minor: number) => money(minor, currency);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 }}
      >
        <Row gap="sm" style={{ justifyContent: 'space-between' }}>
          <Button
            label={`${prevGlyph}`}
            variant="secondary"
            accessibilityLabel={t('home.previousMonth')}
            onPress={() => setMonth(previous(month))}
            testID="prev-month"
          />
          <Text variant="title" accessibilityRole="header" testID="month-title">
            {f.monthYear(month.start)}
          </Text>
          <Button
            label={`${nextGlyph}`}
            variant="secondary"
            accessibilityLabel={t('home.nextMonth')}
            onPress={() => setMonth(next(month))}
            testID="next-month"
          />
        </Row>

        <Segmented
          label={t('home.title')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'income', label: t('home.tabIncome') },
            { value: 'balance', label: t('home.tabBalance') },
            { value: 'expense', label: t('home.tabExpense') },
          ]}
        />

        <Card>
          <MonthCalendar
            month={month}
            firstDayOfWeek={settings.firstDayOfWeek}
            days={days}
            today={today}
            currency={currency}
            f={f}
            onDayPress={nav.onDay}
          />
        </Card>

        {!hasAny ? (
          <EmptyState
            title={t('home.emptyTitle')}
            body={t('home.emptyBody')}
            action={{ label: t('home.addFirst'), onPress: () => nav.onAdd() }}
          />
        ) : (
          <>
            <Card testID="totals">
              <Row gap="md" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <Stack gap="xxs">
                  <Text variant="caption" tone="muted">
                    {t('home.tabIncome')}
                  </Text>
                  <AmountText
                    money={m(totals.incomeMinor)}
                    kind="income"
                    format={{ currencyDisplay: 'none' }}
                    spokenLabel={(a) => t('amount.income', { amount: a })}
                    testID="total-income"
                  />
                </Stack>
                <Stack gap="xxs">
                  <Text variant="caption" tone="muted">
                    {t('home.spentSoFar')}
                  </Text>
                  <AmountText
                    money={m(totals.spentSoFarMinor)}
                    kind="expense"
                    format={{ currencyDisplay: 'none' }}
                    spokenLabel={(a) => t('amount.expense', { amount: a })}
                    testID="total-spent"
                  />
                </Stack>
                <Stack gap="xxs">
                  <Text variant="caption" tone="muted">
                    {t('home.net')}
                  </Text>
                  <AmountText
                    money={m(totals.incomeMinor - totals.spentSoFarMinor)}
                    kind="neutral"
                    format={{ currencyDisplay: 'none', signDisplay: 'always' }}
                    spokenLabel={(a) => t('amount.neutral', { amount: a })}
                  />
                </Stack>
              </Row>
              {totals.scheduledExpenseMinor > 0 ? (
                <Text tone="warning" variant="caption" testID="scheduled-total">
                  ⏱ {t('home.scheduled')}: {f.money(m(totals.scheduledExpenseMinor))}
                </Text>
              ) : null}
            </Card>

            {tab === 'balance' ? (
              <Card testID="balance-panel">
                <Text variant="caption" tone="muted">
                  {t('home.balanceAll')}
                </Text>
                <Text variant="title" testID="net-worth">
                  {f.money(m(net.totalMinor))}
                </Text>
                {net.missingRateAccountIds.length > 0 ? (
                  <Banner tone="warning" message={t('home.missingRate')} />
                ) : null}
                {accounts.map((a) => (
                  <Row key={a.id} gap="sm" style={{ justifyContent: 'space-between' }}>
                    <Text>
                      {a.icon} {a.name}
                    </Text>
                    <Text>
                      {f.money(
                        money(
                          balances.get(a.id) ?? a.openingBalanceMinor,
                          a.currency as typeof currency,
                        ),
                      )}
                    </Text>
                  </Row>
                ))}
                <Button label={t('accounts.title')} variant="secondary" onPress={nav.onAccounts} />
              </Card>
            ) : (
              <Card testID="category-bars">
                {byCategory.length === 0 ? (
                  <Text tone="muted">{t('home.noCategoryData')}</Text>
                ) : (
                  byCategory.map((c) => {
                    const cat = catById.get(c.categoryId);
                    const percent = Math.round(c.share * 100);
                    const name = f.categoryName(cat);
                    const amount = f.money(m(c.totalMinor));
                    return (
                      <Pressable
                        key={c.categoryId}
                        testID={`category-bar-${c.categoryId}`}
                        accessibilityRole="button"
                        accessibilityLabel={t('home.categoryShare', {
                          name,
                          amount,
                          percent: f.digits(percent),
                        })}
                        onPress={() => nav.onCategory(c.categoryId, month)}
                        style={({ pressed }) => ({
                          gap: spacing.xs,
                          paddingVertical: spacing.xs,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Row gap="sm" style={{ justifyContent: 'space-between' }}>
                          <Text style={{ flex: 1 }} numberOfLines={1}>
                            {cat?.icon} {name}
                          </Text>
                          <Text variant="bodyStrong">{amount}</Text>
                          <Text tone="muted">{f.digits(percent)}%</Text>
                        </Row>
                        <View
                          style={{
                            height: 6,
                            borderRadius: radius.pill,
                            backgroundColor: colors.border,
                          }}
                        >
                          <View
                            style={{
                              width: `${Math.max(2, percent)}%`,
                              height: 6,
                              borderRadius: radius.pill,
                              backgroundColor: tab === 'income' ? colors.income : colors.expense,
                            }}
                          />
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </Card>
            )}
            <Button
              label={t('home.allTransactions')}
              variant="secondary"
              onPress={nav.onAllTransactions}
            />
          </>
        )}
      </ScrollView>
      <Fab label={t('home.quickAdd')} onPress={() => nav.onAdd()} />
    </SafeAreaView>
  );
}
