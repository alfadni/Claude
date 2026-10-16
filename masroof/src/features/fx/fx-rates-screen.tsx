import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isLocalDate, parseRate, type CurrencyCode, type LocalDate } from '@/domain';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ListRow,
  spacing,
  Stack,
  Text,
  TextField,
  useTheme,
} from '@/ui';

import { CurrencyPicker } from '../accounts/currency-picker';
import { useLedger, useSession } from '../session/session';
import { useFormat } from '../session/use-format';

/** Manual FX table (ADR-015): rates into the main currency. */
export function FxRatesScreen() {
  const session = useSession();
  const { repos, settings } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const base = settings.baseCurrency;
  const rates = useLedger((r) => r.fx.list(), []);
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState<CurrencyCode>(base === 'USD' ? 'EUR' : 'USD');
  const [rateText, setRateText] = useState('');
  const [date, setDate] = useState<string>(repos.today());
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (from === base) return setError(t('fx.same_currency'));
    const rate = parseRate(rateText.replace(f.decimalSeparator, '.'));
    if (!rate.ok) return setError(f.error('rate_invalid'));
    if (!isLocalDate(date)) return setError(f.error('custom_dates_invalid'));
    repos.fx.record(from, base, rate.value, date as LocalDate);
    setError(null);
    setAdding(false);
    setRateText('');
    session.haptic('success');
    session.bump();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
        testID="fx-rates"
      >
        <Text tone="muted">{t('fx.intro')}</Text>
        {adding ? (
          <Card testID="fx-form">
            <Stack gap="xs">
              <Text variant="caption" tone="muted">
                {t('fx.from')}
              </Text>
              <CurrencyPicker
                value={from}
                onChange={setFrom}
                label={t('fx.from')}
                searchLabel={t('onboarding.currencySearch')}
              />
            </Stack>
            <TextField
              label={t('fx.rate', { from, to: base })}
              value={rateText}
              onChangeText={setRateText}
              keyboardType="decimal-pad"
              testID="fx-rate"
            />
            <TextField
              label={t('fx.date')}
              value={date}
              onChangeText={setDate}
              autoCapitalize="none"
              testID="fx-date"
            />
            {error ? <Banner tone="danger" message={error} testID="fx-error" /> : null}
            <Button label={t('common.save')} onPress={save} testID="fx-save" />
            <Button
              label={t('common.cancel')}
              variant="secondary"
              onPress={() => setAdding(false)}
            />
          </Card>
        ) : (
          <Button label={t('fx.add')} onPress={() => setAdding(true)} testID="fx-add" />
        )}
        {rates.length === 0 ? (
          <EmptyState title={t('fx.title')} body={t('fx.empty')} />
        ) : (
          rates.map((r) => (
            <ListRow
              key={r.id}
              title={t('fx.rateLine', { from: r.base, rate: f.digits(r.rate), to: r.quote })}
              subtitle={f.date(r.asOf)}
              testID={`fx-${r.id}`}
              trailing={
                <Button
                  label="✕"
                  variant="secondary"
                  accessibilityLabel={t('fx.delete')}
                  onPress={() =>
                    Alert.alert(t('fx.delete'), t('fx.deleteConfirm'), [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('common.delete'),
                        style: 'destructive',
                        onPress: () => {
                          repos.fx.remove(r.id);
                          session.bump();
                        },
                      },
                    ])
                  }
                  testID={`fx-delete-${r.id}`}
                />
              }
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
