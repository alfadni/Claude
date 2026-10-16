import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ACCOUNT_ICONS,
  ACCOUNT_TYPES,
  isLocalDate,
  money,
  parseAmount,
  toDecimalString,
  type AccountType,
  type CurrencyCode,
  type LocalDate,
} from '@/domain';
import { Banner, Button, Chip, Row, spacing, Stack, Text, TextField, useTheme } from '@/ui';

import { useSession } from '../session/session';
import { tDynamic, useFormat } from '../session/use-format';
import { CurrencyPicker } from './currency-picker';

export function AccountFormScreen({ id, onDone }: { id: string | null; onDone: () => void }) {
  const session = useSession();
  const { repos, settings } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const existing = id ? repos.accounts.get(id) : undefined;
  const locked = !!existing && repos.accounts.hasTransactions(existing.id);

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? 'bank');
  const [currency, setCurrency] = useState<CurrencyCode>(
    (existing?.currency as CurrencyCode) ?? settings.baseCurrency,
  );
  const [opening, setOpening] = useState(
    existing
      ? toDecimalString(money(existing.openingBalanceMinor, existing.currency as CurrencyCode))
      : '0',
  );
  const [openedOn, setOpenedOn] = useState(existing?.openedOn ?? '');
  const [include, setInclude] = useState(existing?.includeInTotals ?? true);
  const [errors, setErrors] = useState<string[]>([]);

  function save() {
    const parsed = parseAmount(opening || '0', currency, {
      allowNegative: true,
      decimalSeparator: f.decimalSeparator,
    });
    const problems: string[] = [];
    if (!parsed.ok) problems.push('opening_balance_invalid');
    if (openedOn && !isLocalDate(openedOn)) problems.push('opened_on_invalid');
    if (problems.length || !parsed.ok) return setErrors(problems);
    const input = {
      name,
      type,
      currency,
      openingBalanceMinor: parsed.value.amountMinor,
      openedOn: openedOn ? (openedOn as LocalDate) : null,
      includeInTotals: include,
      icon: existing?.icon ?? ACCOUNT_ICONS[type],
    };
    const r = existing ? repos.accounts.update(existing.id, input) : repos.accounts.create(input);
    if (!r.ok) return setErrors([...r.error]);
    session.bump();
    onDone();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        testID="account-form"
      >
        <TextField
          label={t('accounts.name')}
          value={name}
          onChangeText={setName}
          maxLength={40}
          testID="account-name"
        />
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {t('accounts.type')}
          </Text>
          <Row gap="sm" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
            {ACCOUNT_TYPES.map((ty) => (
              <Chip
                key={ty}
                icon={ACCOUNT_ICONS[ty]}
                label={tDynamic(t, `accounts.types.${ty}`)}
                selected={ty === type}
                onPress={() => setType(ty)}
              />
            ))}
          </Row>
        </Stack>
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {t('accounts.currency')}
          </Text>
          {locked ? (
            <Text>
              {currency} · {t('errors.currency_locked')}
            </Text>
          ) : (
            <CurrencyPicker
              value={currency}
              onChange={setCurrency}
              label={t('accounts.currency')}
              searchLabel={t('onboarding.currencySearch')}
              preferred={settings.baseCurrency}
            />
          )}
        </Stack>
        <TextField
          label={t('accounts.openingBalance')}
          value={opening}
          onChangeText={setOpening}
          keyboardType="numbers-and-punctuation"
          testID="account-opening"
        />
        <TextField
          label={`${t('accounts.openedOn')} (${t('common.optional')})`}
          value={openedOn}
          onChangeText={setOpenedOn}
          placeholder="2026-01-01"
          autoCapitalize="none"
        />
        <Chip
          role="checkbox"
          label={t('accounts.includeInTotals')}
          selected={include}
          onPress={() => setInclude(!include)}
        />
        {errors.map((e) => (
          <Banner key={e} tone="danger" message={f.error(e)} />
        ))}
        <Button label={t('common.save')} onPress={save} testID="account-save" />
        {existing ? (
          <Button
            label={existing.isArchived ? t('common.unarchive') : t('common.archive')}
            variant="secondary"
            onPress={() => {
              repos.accounts.setArchived(existing.id, !existing.isArchived);
              session.bump();
              onDone();
            }}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
