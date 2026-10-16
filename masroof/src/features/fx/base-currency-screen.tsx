import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BaseChangePreview } from '@/data/repositories/base-currency-repository';
import { money, parseRate, type CurrencyCode, type DecimalRate } from '@/domain';
import { Banner, Button, Card, Stack, Text, TextField, spacing, useTheme } from '@/ui';

import { CurrencyPicker } from '../accounts/currency-picker';
import { useLedger, useSession } from '../session/session';
import { useFormat } from '../session/use-format';

/**
 * J10: change the main currency with an explicit preview (ADR-015). Blocked
 * until every currency in history has a rate; original amounts never change.
 */
export function BaseCurrencyScreen({
  onBackup,
  onDone,
}: {
  onBackup: () => void;
  onDone: () => void;
}) {
  const session = useSession();
  const { repos, settings } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const current = settings.baseCurrency;
  const [to, setTo] = useState<CurrencyCode>(current === 'USD' ? 'EUR' : 'USD');
  // Scans history once per currency choice / data change, not on every keystroke.
  const required = useLedger((r) => r.baseCurrency.requiredRates(to), [to]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<BaseChangePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const textFor = (c: CurrencyCode) =>
    texts[`${to}:${c}`] ??
    required.find((r) => r.currency === c)?.suggested?.replace('.', f.decimalSeparator) ??
    '';

  /** Parsed rates; invalid entries are simply missing (the repo then blocks). */
  function rates(): Map<CurrencyCode, DecimalRate> {
    const out = new Map<CurrencyCode, DecimalRate>();
    for (const r of required) {
      const parsed = parseRate(textFor(r.currency).replace(f.decimalSeparator, '.'));
      if (parsed.ok) out.set(r.currency, parsed.value);
    }
    return out;
  }

  function explain(e: { code: string; currencies?: CurrencyCode[] }) {
    return e.code === 'rates_missing'
      ? t('baseCurrency.errors.rates_missing', { currencies: (e.currencies ?? []).join(', ') })
      : t('baseCurrency.errors.same_currency');
  }

  function runPreview() {
    const r = repos.baseCurrency.preview(to, rates());
    if (!r.ok) {
      setPreview(null);
      return setError(explain(r.error));
    }
    setError(null);
    setPreview(r.value);
  }

  function apply() {
    Alert.alert(t('baseCurrency.confirmTitle'), t('baseCurrency.confirmBody', { currency: to }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('baseCurrency.apply', { currency: to }),
        onPress: () => {
          const r = repos.baseCurrency.apply(to, rates());
          if (!r.ok) return setError(explain(r.error));
          session.haptic('success');
          session.bump();
          onDone();
        },
      },
    ]);
  }

  const fm = (minor: number, c: CurrencyCode) => f.money(money(minor, c));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        testID="base-currency"
      >
        <Text variant="bodyStrong">{t('baseCurrency.current', { currency: current })}</Text>
        <Text tone="muted">{t('baseCurrency.intro')}</Text>
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {t('baseCurrency.choose')}
          </Text>
          <CurrencyPicker
            value={to}
            onChange={(c) => {
              setTo(c);
              setPreview(null);
              setError(null);
            }}
            label={t('baseCurrency.choose')}
            searchLabel={t('onboarding.currencySearch')}
          />
        </Stack>
        <Card>
          <Text variant="bodyStrong">{t('baseCurrency.ratesTitle', { to })}</Text>
          {required.length === 0 ? (
            <Text tone="muted">{t('baseCurrency.noRatesNeeded')}</Text>
          ) : (
            required.map((r) => (
              <TextField
                key={`${to}:${r.currency}`}
                label={t('baseCurrency.rateFor', { from: r.currency, to })}
                hint={t('baseCurrency.usage', {
                  transactions: f.digits(r.transactions),
                  budgets: f.digits(r.budgets),
                })}
                value={textFor(r.currency)}
                onChangeText={(v) => {
                  setTexts((cur) => ({ ...cur, [`${to}:${r.currency}`]: v }));
                  setPreview(null);
                }}
                keyboardType="decimal-pad"
                testID={`rate-${r.currency}`}
              />
            ))
          )}
        </Card>
        {error ? <Banner tone="danger" message={error} testID="base-error" /> : null}
        <Button
          label={t('baseCurrency.preview')}
          variant="secondary"
          onPress={runPreview}
          testID="base-preview"
        />
        {preview ? (
          <Card testID="base-preview-card">
            <Text variant="bodyStrong">{t('baseCurrency.previewTitle')}</Text>
            {(
              [
                ['home.tabIncome', 'incomeMinor'],
                ['home.spentSoFar', 'spentSoFarMinor'],
              ] as const
            ).map(([label, key]) => (
              <Text key={key}>
                {t('baseCurrency.previewLine', {
                  label: t(label),
                  before: fm(preview.before[key], preview.from),
                  after: fm(preview.after[key], preview.to),
                })}
              </Text>
            ))}
            <Text tone="muted">
              {t('baseCurrency.previewCounts', {
                transactions: f.digits(preview.transactions),
                budgets: f.digits(preview.budgets),
              })}
            </Text>
            <Banner
              tone="warning"
              message={t('baseCurrency.roundTrip')}
              action={{ label: t('baseCurrency.backupFirst'), onPress: onBackup }}
            />
            <Button
              label={t('baseCurrency.apply', { currency: to })}
              onPress={apply}
              testID="base-apply"
            />
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
