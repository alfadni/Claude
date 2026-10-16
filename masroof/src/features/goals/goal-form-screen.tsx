import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  isLocalDate,
  money,
  parseAmount,
  toDecimalString,
  type CurrencyCode,
  type LocalDate,
} from '@/domain';
import { Banner, Button, Chip, Row, spacing, Stack, Text, TextField, useTheme } from '@/ui';

import { useSession } from '../session/session';
import { useFormat } from '../session/use-format';

export function GoalFormScreen({ id, onDone }: { id: string | null; onDone: () => void }) {
  const session = useSession();
  const { repos } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const existing = id ? repos.goals.get(id) : undefined;
  const accounts = repos.accounts.list();
  const preferred = accounts.find((a) => a.type === 'savings')?.id ?? accounts[0]?.id ?? null;

  const [name, setName] = useState(existing?.name ?? '');
  const [accountId, setAccountId] = useState<string | null>(existing?.linkedAccountId ?? preferred);
  const currency = (repos.accounts.get(accountId ?? '')?.currency ??
    existing?.currency ??
    session.settings.baseCurrency) as CurrencyCode;
  const [target, setTarget] = useState(
    existing ? toDecimalString(money(existing.targetMinor, existing.currency as CurrencyCode)) : '',
  );
  const [date, setDate] = useState(existing?.targetDate ?? '');
  const [errors, setErrors] = useState<string[]>([]);

  function save() {
    const parsed = parseAmount(target, currency, { decimalSeparator: f.decimalSeparator });
    const problems: string[] = [];
    if (!parsed.ok || parsed.value.amountMinor <= 0) problems.push('target_invalid');
    if (date && !isLocalDate(date)) problems.push('custom_dates_invalid');
    if (problems.length > 0 || !parsed.ok) return setErrors(problems);
    const input = {
      name,
      targetMinor: parsed.value.amountMinor,
      targetDate: date ? (date as LocalDate) : null,
      linkedAccountId: accountId,
    };
    const r = existing ? repos.goals.update(existing.id, input) : repos.goals.create(input);
    if (!r.ok) return setErrors([...r.error]);
    session.haptic('success');
    session.bump();
    onDone();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        testID="goal-form"
      >
        <TextField
          label={t('goals.name')}
          value={name}
          onChangeText={setName}
          maxLength={60}
          testID="goal-name"
        />
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {t('goals.account')}
          </Text>
          <Row gap="sm" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
            {accounts.map((a) => (
              <Chip
                key={a.id}
                icon={a.icon}
                label={`${a.name} · ${a.currency}`}
                selected={a.id === accountId}
                onPress={() => setAccountId(a.id)}
                testID={`goal-account-${a.id}`}
              />
            ))}
          </Row>
        </Stack>
        <TextField
          label={`${t('goals.target')} (${currency})`}
          value={target}
          onChangeText={setTarget}
          keyboardType="decimal-pad"
          testID="goal-target"
        />
        <TextField
          label={t('goals.targetDate')}
          value={date}
          onChangeText={setDate}
          placeholder="2027-06-30"
          autoCapitalize="none"
          testID="goal-date"
        />
        {errors.map((e) => (
          <Banner key={e} tone="danger" message={f.error(e)} />
        ))}
        <Button label={t('common.save')} onPress={save} testID="goal-save" />
        {existing ? (
          <Button
            label={t('goals.delete')}
            variant="danger"
            onPress={() =>
              Alert.alert(t('goals.delete'), t('goals.deleteConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.delete'),
                  style: 'destructive',
                  onPress: () => {
                    repos.goals.delete(existing.id);
                    session.bump();
                    onDone();
                  },
                },
              ])
            }
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
