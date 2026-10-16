import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DEFAULT_THRESHOLDS,
  money,
  parseAmount,
  parseThresholds,
  toDecimalString,
  type BudgetPeriodKind,
} from '@/domain';
import {
  Banner,
  Button,
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
import { useFormat } from '../session/use-format';

const THRESHOLD_CHOICES = [50, 75, 80, 90, 100] as const;

/** Create or edit a budget; amounts are in the base currency (ADR-014). */
export function BudgetFormScreen({ id, onDone }: { id: string | null; onDone: () => void }) {
  const session = useSession();
  const { repos, settings } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const existing = id ? repos.budgets.get(id) : undefined;
  const currency = settings.baseCurrency;
  const categories = repos.categories
    .list('expense', { includeArchived: true })
    .filter((c) => !c.isArchived || c.id === existing?.categoryId);

  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [period, setPeriod] = useState<Exclude<BudgetPeriodKind, 'custom'>>(
    existing?.period === 'weekly' ? 'weekly' : 'monthly',
  );
  const [amount, setAmount] = useState(
    existing ? toDecimalString(money(existing.amountMinor, currency)) : '',
  );
  const [rollover, setRollover] = useState(existing?.rollover ?? false);
  const [thresholds, setThresholds] = useState<number[]>(
    existing ? parseThresholds(existing.alertThresholds) : [...DEFAULT_THRESHOLDS],
  );
  const [errors, setErrors] = useState<string[]>([]);
  const archived =
    !!existing?.categoryId && !!repos.categories.get(existing.categoryId)?.isArchived;

  const toggle = (v: number) =>
    setThresholds((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  async function save() {
    const parsed = parseAmount(amount, currency, { decimalSeparator: f.decimalSeparator });
    if (!parsed.ok || parsed.value.amountMinor <= 0) return setErrors(['amount_invalid']);
    const input = {
      categoryId,
      period,
      amountMinor: parsed.value.amountMinor,
      rollover,
      thresholds,
    };
    const r = existing ? repos.budgets.update(existing.id, input) : repos.budgets.create(input);
    if (!r.ok) return setErrors([...r.error]);
    session.haptic('success');
    session.bump();
    await session.requestNotifications();
    onDone();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        testID="budget-form"
      >
        {archived ? <Banner tone="warning" message={t('budgets.archivedCategory')} /> : null}
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {t('budgets.category')}
          </Text>
          <Row gap="sm" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
            <Chip
              label={t('budgets.overall')}
              selected={categoryId === null}
              onPress={() => setCategoryId(null)}
              testID="budget-cat-overall"
            />
            {categories.map((c) => (
              <Chip
                key={c.id}
                icon={c.icon}
                label={f.categoryName(c)}
                selected={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
                testID={`budget-cat-${c.id}`}
              />
            ))}
          </Row>
        </Stack>
        <Segmented
          label={t('budgets.period')}
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'monthly', label: t('budgets.monthly') },
            { value: 'weekly', label: t('budgets.weekly') },
          ]}
        />
        <TextField
          label={`${t('budgets.amount')} (${currency})`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          testID="budget-amount"
        />
        <Chip
          role="checkbox"
          label={t('budgets.rollover')}
          selected={rollover}
          onPress={() => setRollover(!rollover)}
          testID="budget-rollover"
        />
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {t('budgets.thresholds')}
          </Text>
          <Row gap="sm" style={{ flexWrap: 'wrap' }}>
            {THRESHOLD_CHOICES.map((v) => (
              <Chip
                key={v}
                role="checkbox"
                label={`${f.digits(v)}%`}
                selected={thresholds.includes(v)}
                onPress={() => toggle(v)}
                testID={`threshold-${v}`}
              />
            ))}
          </Row>
        </Stack>
        {errors.map((e) => (
          <Banner key={e} tone="danger" message={f.error(e)} />
        ))}
        <Button label={t('common.save')} onPress={() => void save()} testID="budget-save" />
        {existing ? (
          <Button
            label={t('budgets.delete')}
            variant="danger"
            onPress={() =>
              Alert.alert(t('budgets.delete'), t('budgets.deleteConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.delete'),
                  style: 'destructive',
                  onPress: () => {
                    repos.budgets.delete(existing.id);
                    session.bump();
                    onDone();
                  },
                },
              ])
            }
            testID="budget-delete"
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
