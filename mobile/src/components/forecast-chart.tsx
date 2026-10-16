import { useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';

import type { ForecastResponse } from '@/api/types';
import { computeGeometry, type ChartBox } from '@/lib/chart';
import { formatDate, formatUsd } from '@/lib/format';
import { space, usePalette } from '@/lib/theme';

const HEIGHT = 240;
const PAD = { padLeft: 58, padRight: 8, padTop: 8, padBottom: 22 };
// SVG text doesn't inherit the app font on web (it falls back to serif).
const SVG_FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, sans-serif' : undefined;

export function ForecastChart({ data }: { data: ForecastResponse }) {
  const c = usePalette();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const box: ChartBox = { width, height: HEIGHT, ...PAD };
  const g = width > 0 ? computeGeometry(data.history, data.forecast, box) : null;
  // Over long spans the same day-month repeats across the axis, so add the year.
  const axisYears = data.history.length + data.forecast.length > 300;
  const s = data.summary;
  const a11y =
    `Chart of the last ${data.history.length} days of XRP prices and a ${data.horizon_days}-day forecast. ` +
    `Median ${formatUsd(s.p50)} on ${formatDate(s.date)}; 50% range ${formatUsd(s.p25)} to ${formatUsd(s.p75)}; ` +
    `90% range ${formatUsd(s.p05)} to ${formatUsd(s.p95)}.`;

  return (
    <View>
      <View
        onLayout={onLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={a11y}
        style={{ height: HEIGHT }}>
        {g ? (
          <Svg width={width} height={HEIGHT}>
            {g.yTicks.map((t) => (
              <Line
                key={`g${t.value}`}
                x1={PAD.padLeft}
                x2={width - PAD.padRight}
                y1={t.y}
                y2={t.y}
                stroke={c.grid}
                strokeWidth={1}
              />
            ))}
            {g.yTicks.map((t) => (
              <SvgText
                key={`t${t.value}`}
                x={PAD.padLeft - 6}
                y={t.y + 4}
                fontSize={11}
                fontFamily={SVG_FONT}
                fill={c.textMuted}
                textAnchor="end">
                {formatUsd(t.value)}
              </SvgText>
            ))}
            <Path d={g.band90Path} fill={c.bandOuter} />
            <Path d={g.band50Path} fill={c.bandInner} />
            <Line
              x1={g.todayX}
              x2={g.todayX}
              y1={PAD.padTop}
              y2={HEIGHT - PAD.padBottom}
              stroke={c.border}
              strokeDasharray="3,3"
            />
            <Path d={g.historyPath} stroke={c.text} strokeWidth={1.5} fill="none" />
            <Path d={g.medianPath} stroke={c.accent} strokeWidth={2} strokeDasharray="5,3" fill="none" />
            {g.xLabels.map((l) => (
              <SvgText
                key={l.date}
                x={l.x}
                y={HEIGHT - 6}
                fontSize={11}
                fontFamily={SVG_FONT}
                fill={c.textMuted}
                textAnchor={l.anchor}>
                {formatDate(l.date, axisYears)}
              </SvgText>
            ))}
          </Svg>
        ) : null}
      </View>
      <View style={styles.legend} importantForAccessibility="no-hide-descendants">
        <LegendSwatch color={c.text} label="Price" />
        <LegendSwatch color={c.accent} label="Median" />
        <LegendSwatch color={c.bandInner} label="50% range" block />
        <LegendSwatch color={c.bandOuter} label="90% range" block />
      </View>
      {g?.clipped ? (
        <Text style={[styles.note, { color: c.textMuted }]}>
          The 90% range is wider than the chart shows; exact values are below.
        </Text>
      ) : null}
    </View>
  );
}

function LegendSwatch({ color, label, block }: { color: string; label: string; block?: boolean }) {
  const c = usePalette();
  return (
    <View style={styles.legendItem}>
      <View style={[block ? styles.swatchBlock : styles.swatchLine, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: c.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatchLine: { width: 14, height: 2, borderRadius: 1 },
  swatchBlock: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 12 },
  note: { fontSize: 12, marginTop: space.xs },
});
