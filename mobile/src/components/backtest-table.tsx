import { StyleSheet, Text, View } from 'react-native';

import type { ForecastResponse } from '@/api/types';
import { formatPct } from '@/lib/format';
import { space, usePalette } from '@/lib/theme';

const NAMES: Record<string, string> = {
  ensemble: 'Ensemble (shown)',
  random_walk: 'No-change baseline',
  gbm: 'GBM',
  bootstrap: 'Bootstrap',
  log_trend: 'Log trend',
  holt_damped: 'Holt damped',
};

/** Plain-language verdicts on the backtest, so users know how far to trust the chart. */
export function backtestNotes(bt: NonNullable<ForecastResponse['backtest']>, model: string): string[] {
  const shown = bt.models.find((m) => m.model === model);
  const baseline = bt.models.find((m) => m.model === 'random_walk');
  const notes: string[] = [];
  if (shown && baseline && model !== 'random_walk' && shown.mape >= baseline.mape) {
    notes.push(
      "In past tests this forecast's median was no more accurate than assuming no change. Treat its up/down direction as noise and read the ranges instead.",
    );
  }
  if (shown && shown.coverage_90 < 0.8) {
    notes.push(
      `Only ${formatPct(shown.coverage_90 * 100)} of past outcomes fell inside the 90% range, so the ranges have been too narrow.`,
    );
  }
  return notes;
}

export function BacktestTable({ data }: { data: ForecastResponse }) {
  const c = usePalette();
  const bt = data.backtest;
  if (!bt || bt.models.length === 0) {
    return (
      <Text style={[styles.empty, { color: c.textMuted }]}>
        Not enough price history to test this forecast against past data yet.
      </Text>
    );
  }
  const notes = backtestNotes(bt, data.model);
  return (
    <View testID="backtest" style={styles.wrap}>
      <Text style={[styles.caption, { color: c.textMuted }]}>
        How it did: {bt.horizon_days}-day forecasts at {bt.models[0].n} past dates
      </Text>
      <View style={[styles.row, styles.header, { borderColor: c.border }]}>
        <Text style={[styles.cellName, styles.headText, { color: c.textMuted }]}>Model</Text>
        <Text style={[styles.cell, styles.headText, { color: c.textMuted }]}>Typical miss</Text>
        <Text style={[styles.cell, styles.headText, { color: c.textMuted }]}>In 90% range</Text>
      </View>
      {bt.models.map((m) => {
        const emphasis = m.model === data.model;
        const weight = emphasis ? ('700' as const) : ('400' as const);
        return (
          <View key={m.model} style={[styles.row, { borderColor: c.border }]}>
            <Text style={[styles.cellName, { color: c.text, fontWeight: weight }]}>
              {NAMES[m.model] ?? m.model}
            </Text>
            <Text style={[styles.cell, { color: c.text, fontWeight: weight }]}>
              {formatPct(m.mape * 100)}
            </Text>
            <Text style={[styles.cell, { color: c.text, fontWeight: weight }]}>
              {formatPct(m.coverage_90 * 100)}
            </Text>
          </View>
        );
      })}
      {notes.map((n) => (
        <Text key={n} style={[styles.note, { color: c.warnText, backgroundColor: c.warnBg }]}>
          {n}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  caption: { fontSize: 13, fontWeight: '600', marginBottom: space.xs },
  row: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  header: { paddingTop: 0 },
  headText: { fontSize: 12, fontWeight: '600' },
  cellName: { flex: 1.6, fontSize: 14 },
  cell: { flex: 1, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] },
  note: {
    fontSize: 13,
    lineHeight: 18,
    padding: space.sm,
    borderRadius: 8,
    marginTop: space.sm,
    overflow: 'hidden',
  },
  empty: { fontSize: 13 },
});
