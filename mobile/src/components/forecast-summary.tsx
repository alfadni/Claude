import { StyleSheet, Text, View } from 'react-native';

import type { ForecastResponse } from '@/api/types';
import { formatDate, formatPct, formatUsd } from '@/lib/format';
import { space, usePalette } from '@/lib/theme';

export function ForecastSummary({ data }: { data: ForecastResponse }) {
  const c = usePalette();
  const s = data.summary;
  const change = s.median_change_pct;
  const changeColor = Math.abs(change) < 0.05 ? c.textMuted : change > 0 ? c.positive : c.negative;
  return (
    <View testID="forecast-summary" style={styles.wrap}>
      <Text style={[styles.caption, { color: c.textMuted }]}>Forecast for {formatDate(s.date)}</Text>
      {/* One stat per row: a price range doesn't fit half a phone width. */}
      <Stat label="Median" value={formatUsd(s.p50)} sub={formatPct(change, true)} subColor={changeColor} />
      <Stat label="50% range" value={`${formatUsd(s.p25)} – ${formatUsd(s.p75)}`} />
      <Stat label="90% range" value={`${formatUsd(s.p05)} – ${formatUsd(s.p95)}`} />
      <Text style={[styles.explain, { color: c.textMuted }]}>
        If the model is well calibrated, the price lands inside the 90% range 9 times out of 10 — and outside
        it the rest of the time.
      </Text>
    </View>
  );
}

function Stat({
  label,
  value,
  sub,
  subColor,
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}) {
  const c = usePalette();
  return (
    <View style={styles.stat}>
      <Text style={[styles.label, { color: c.textMuted }]}>{label}</Text>
      <Text style={[styles.value, { color: c.text }]}>{value}</Text>
      {sub ? <Text style={[styles.sub, { color: subColor }]}>{sub} vs today</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  caption: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  stat: { gap: 2 },
  label: { fontSize: 13 },
  value: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sub: { fontSize: 13, fontWeight: '600' },
  explain: { fontSize: 12, lineHeight: 17 },
});
