import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  isLocalDate,
  parts,
  RECURRING_MODES,
  weekday,
  type Frequency,
  type LocalDate,
  type RecurrencePattern,
  type RecurringMode,
  type Weekday,
} from '@/domain';
import {
  Banner,
  Button,
  Card,
  Chip,
  Row,
  Segmented,
  spacing,
  Stack,
  Text,
  TextField,
  useTheme,
} from '@/ui';

import { useSession } from '../session/session';
import { tDynamic, useFormat } from '../session/use-format';

type EndKind = 'never' | 'date' | 'count';
const FREQUENCIES: readonly Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];
/** Monday-first chip order; values are JS weekdays (0 = Sunday). */
const WEEK: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/**
 * Create a rule from a transaction ("Repeat…") or edit an existing rule
 * (ADR-013). Saving asks for notification permission in context (ADR-014).
 */
export function RecurringFormScreen({
  ruleId,
  transactionId,
  onDone,
}: {
  ruleId: string | null;
  transactionId: string | null;
  onDone: () => void;
}) {
  const session = useSession();
  const { repos } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const rule = ruleId ? repos.recurring.get(ruleId) : null;
  const tx = transactionId ? repos.transactions.get(transactionId) : undefined;
  const anchor = (rule?.schedule.startsOn ?? tx?.occurredOn ?? repos.today()) as LocalDate;
  const storedDay = rule?.schedule.pattern.byMonthDay;
  const dateDay = storedDay && storedDay > 0 ? storedDay : parts(anchor).day;

  const [frequency, setFrequency] = useState<Frequency>(
    rule?.schedule.pattern.frequency ?? 'monthly',
  );
  const [interval, setIntervalText] = useState(String(rule?.schedule.pattern.interval ?? 1));
  const [monthDay, setMonthDay] = useState<number>(storedDay ?? parts(anchor).day);
  const [days, setDays] = useState<Weekday[]>(
    rule?.schedule.pattern.byWeekday?.length
      ? [...rule.schedule.pattern.byWeekday]
      : [weekday(anchor)],
  );
  const [endKind, setEndKind] = useState<EndKind>(
    rule?.schedule.endsOn ? 'date' : rule?.schedule.maxOccurrences ? 'count' : 'never',
  );
  const [endDate, setEndDate] = useState(rule?.schedule.endsOn ?? '');
  const [count, setCount] = useState(String(rule?.schedule.maxOccurrences ?? 12));
  const [mode, setMode] = useState<RecurringMode>(rule?.mode ?? 'auto_post');
  const [errors, setErrors] = useState<string[]>([]);

  if (!rule && !tx) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <Banner tone="danger" message={f.error('transaction_not_eligible')} />
      </SafeAreaView>
    );
  }

  const toggleDay = (d: Weekday) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  async function save() {
    const n = Number(interval);
    const pattern: RecurrencePattern = {
      frequency,
      interval: Number.isInteger(n) ? n : 0,
      byWeekday: frequency === 'weekly' ? days : undefined,
      byMonthDay: frequency === 'monthly' ? monthDay : undefined,
    };
    const problems: string[] = [];
    if (frequency === 'weekly' && days.length === 0) problems.push('weekday_invalid');
    if (endKind === 'date' && !isLocalDate(endDate)) problems.push('custom_dates_invalid');
    if (problems.length > 0) return setErrors(problems);
    const settings = {
      pattern,
      mode,
      endsOn: endKind === 'date' ? (endDate as LocalDate) : null,
      maxOccurrences: endKind === 'count' ? Number(count) : null,
    };
    const r = rule
      ? repos.recurring.updateSettings(rule.id, settings)
      : repos.recurring.createFromTransaction(transactionId as string, settings);
    if (!r.ok) return setErrors([...new Set(r.error)]);
    setErrors([]);
    session.haptic('success');
    // A start in the past may already have due occurrences: run now (idempotent).
    await session.planning.run({ background: false });
    session.bump();
    await session.requestNotifications();
    await session.planning.refreshReminders();
    onDone();
  }

  function remove() {
    if (!rule) return;
    Alert.alert(t('planning.delete'), t('planning.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          repos.recurring.delete(rule.id);
          session.bump();
          void session.planning.refreshReminders();
          onDone();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        testID="recurring-form"
      >
        <Segmented
          label={t('planning.frequency')}
          value={frequency}
          onChange={setFrequency}
          options={FREQUENCIES.map((v) => ({ value: v, label: tDynamic(t, `planning.${v}`) }))}
        />
        <TextField
          label={t('planning.every')}
          value={interval}
          onChangeText={setIntervalText}
          keyboardType="number-pad"
          maxLength={2}
          testID="recurring-interval"
        />
        {frequency === 'monthly' ? (
          <Stack gap="xs">
            <Row gap="sm" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
              <Chip
                label={t('planning.onDay', { day: f.digits(dateDay) })}
                selected={monthDay === dateDay}
                onPress={() => setMonthDay(dateDay)}
                testID="month-day-date"
              />
              <Chip
                label={t('planning.lastDay')}
                selected={monthDay === -1}
                onPress={() => setMonthDay(-1)}
                testID="month-day-last"
              />
            </Row>
            {monthDay > 28 ? (
              <Text variant="caption" tone="muted">
                {t('planning.monthDayHint')}
              </Text>
            ) : null}
          </Stack>
        ) : null}
        {frequency === 'weekly' ? (
          <Stack gap="xs">
            <Text variant="caption" tone="muted">
              {t('planning.weekdays')}
            </Text>
            <Row gap="sm" style={{ flexWrap: 'wrap' }}>
              {WEEK.map((d) => (
                <Chip
                  key={d}
                  role="checkbox"
                  label={tDynamic(t, `weekdays.short.${d}`)}
                  selected={days.includes(d)}
                  onPress={() => toggleDay(d)}
                />
              ))}
            </Row>
          </Stack>
        ) : null}
        <Card>
          <Text variant="bodyStrong">{t('planning.ends')}</Text>
          <Row gap="sm" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
            {(['never', 'date', 'count'] as const).map((k) => (
              <Chip
                key={k}
                label={t(
                  k === 'never'
                    ? 'planning.never'
                    : k === 'date'
                      ? 'planning.onDate'
                      : 'planning.afterCount',
                )}
                selected={endKind === k}
                onPress={() => setEndKind(k)}
                testID={`ends-${k}`}
              />
            ))}
          </Row>
          {endKind === 'date' ? (
            <TextField
              label={t('planning.endDate')}
              value={endDate}
              onChangeText={setEndDate}
              placeholder="2027-12-31"
              autoCapitalize="none"
              testID="recurring-end-date"
            />
          ) : null}
          {endKind === 'count' ? (
            <TextField
              label={t('planning.count')}
              value={count}
              onChangeText={setCount}
              keyboardType="number-pad"
              maxLength={4}
              testID="recurring-count"
            />
          ) : null}
        </Card>
        <Card accessibilityRole="radiogroup" accessibilityLabel={t('planning.mode')}>
          <Text variant="bodyStrong">{t('planning.mode')}</Text>
          {RECURRING_MODES.map((m) => (
            <Stack key={m} gap="xxs">
              <Chip
                role="radio"
                label={tDynamic(t, `planning.mode_${m}`)}
                selected={mode === m}
                onPress={() => setMode(m)}
                testID={`mode-${m}`}
              />
              <Text variant="caption" tone="muted">
                {tDynamic(t, `planning.mode_${m}_hint`)}
              </Text>
            </Stack>
          ))}
        </Card>
        {errors.map((e) => (
          <Banner key={e} tone="danger" message={f.error(e)} />
        ))}
        <Button label={t('common.save')} onPress={() => void save()} testID="recurring-save" />
        {rule ? (
          <Stack gap="sm">
            <Button
              label={rule.isPaused ? t('planning.resume') : t('planning.pause')}
              variant="secondary"
              onPress={() => {
                repos.recurring.setPaused(rule.id, !rule.isPaused);
                session.bump();
                void session.planning.refreshReminders();
                onDone();
              }}
              testID="recurring-pause"
            />
            <Button
              label={t('planning.delete')}
              variant="danger"
              onPress={remove}
              testID="recurring-delete"
            />
          </Stack>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
