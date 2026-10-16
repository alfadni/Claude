import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FALLBACK_DISCLAIMER, describeError, type ForecastError } from '@/api/client';
import type { Horizon } from '@/api/types';
import { BacktestTable } from '@/components/backtest-table';
import { Banner } from '@/components/banner';
import { ForecastChart } from '@/components/forecast-chart';
import { ForecastSummary } from '@/components/forecast-summary';
import { HorizonPicker } from '@/components/horizon-picker';
import { useForecast, type ForecastState } from '@/hooks/use-forecast';
import { ageInDays, formatAge, formatDate, formatUsd, STALE_AFTER_DAYS } from '@/lib/format';
import { space, usePalette } from '@/lib/theme';

function retryHint(e: ForecastError): string {
  if (e.retryAfterSeconds) {
    return e.retryAfterSeconds <= 90
      ? ' Try again in about a minute.'
      : ` Try again in ${Math.ceil(e.retryAfterSeconds / 60)} minutes.`;
  }
  return '';
}

export default function ForecastScreen() {
  const c = usePalette();
  const [horizon, setHorizon] = useState<Horizon>(30);
  const { state, reload } = useForecast(horizon);
  const disclaimer = state.status === 'ready' ? state.data.disclaimer : FALLBACK_DISCLAIMER;

  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={state.status === 'ready' && state.refreshing}
            onRefresh={reload}
            tintColor={c.textMuted}
          />
        }>
        <HorizonPicker value={horizon} onChange={setHorizon} />
        <Body state={state} reload={reload} />
      </ScrollView>
      <View style={[styles.disclaimer, { borderColor: c.border, backgroundColor: c.surface }]}>
        <Text testID="disclaimer" style={[styles.disclaimerText, { color: c.textMuted }]}>
          {disclaimer}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function Body({ state, reload }: { state: ForecastState; reload: () => void }) {
  const c = usePalette();

  if (state.status === 'loading') {
    return (
      <View style={styles.center} testID="loading">
        <ActivityIndicator color={c.textMuted} />
        <Text style={{ color: c.textMuted }}>Loading forecast…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <Banner
        testID="error"
        tone="error"
        title="Couldn't load the forecast"
        message={describeError(state.error) + retryHint(state.error)}
        actionLabel={state.error.kind === 'config' ? undefined : 'Retry'}
        onAction={reload}
      />
    );
  }

  const { data, source, savedAt, error } = state;
  const ageDays = ageInDays(data.data_as_of);
  const stale = data.stale || ageDays > STALE_AFTER_DAYS;

  return (
    <View style={styles.sections}>
      {error ? (
        <Banner
          testID="refresh-failed"
          tone="warn"
          title={
            source === 'cache' && savedAt
              ? `Showing forecast saved ${formatAge(savedAt)}`
              : "Couldn't refresh"
          }
          message={describeError(error) + retryHint(error)}
          actionLabel="Retry"
          onAction={reload}
        />
      ) : null}
      {stale ? (
        <Banner
          testID="stale"
          tone="warn"
          title="Prices may be out of date"
          message={
            ageDays > STALE_AFTER_DAYS
              ? `The latest price is from ${formatDate(data.data_as_of)}.`
              : (data.stale_reason ?? undefined)
          }
        />
      ) : null}

      <View>
        <Text style={[styles.price, { color: c.text }]} testID="last-close">
          {formatUsd(data.last_close)}
        </Text>
        <Text style={{ color: c.textMuted }}>
          XRP/USD close, {formatDate(data.data_as_of)}
          {source === 'network' ? ` · updated ${formatAge(data.fetched_at)}` : ''}
        </Text>
      </View>

      <Card>
        <ForecastChart data={data} />
      </Card>
      <Card>
        <ForecastSummary data={data} />
      </Card>
      <Card>
        <BacktestTable data={data} />
      </Card>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const c = usePalette();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  sections: { gap: space.lg },
  center: { alignItems: 'center', gap: space.sm, paddingVertical: 48 },
  price: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  disclaimer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  disclaimerText: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
