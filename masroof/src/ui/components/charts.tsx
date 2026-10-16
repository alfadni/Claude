import { View } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { radius, spacing } from '../tokens';
import { Row, Stack } from './layout';
import { Text } from './text';

export type ChartTone = 'income' | 'expense' | 'neutral';

function useToneColor() {
  const { colors } = useTheme();
  return (tone: ChartTone) =>
    tone === 'income' ? colors.income : tone === 'expense' ? colors.expense : colors.primary;
}

/** Share of `max` as a whole percentage for drawing (display only, never money). */
export function sharePercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 100));
}

/**
 * Labelled horizontal bar (ADR-016). Width follows the writing direction; the
 * row is one accessible element whose label the caller formats.
 */
export function HBar({
  label,
  valueText,
  percent,
  tone = 'neutral',
  accessibilityLabel,
  testID,
}: {
  label: string;
  valueText: string;
  percent: number;
  tone?: ChartTone;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const color = useToneColor()(tone);
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={{ gap: spacing.xxs }}
    >
      <Row gap="sm" style={{ justifyContent: 'space-between' }}>
        <Text numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
        <Text variant="bodyStrong">{valueText}</Text>
      </Row>
      <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.border }}>
        <View
          style={{
            width: `${Math.min(100, Math.max(0, percent))}%`,
            height: 8,
            borderRadius: radius.pill,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

export type ColumnGroup = Readonly<{
  key: string;
  /** Short axis label, e.g. a month abbreviation. */
  label: string;
  /** Spoken summary of the whole group. */
  accessibilityLabel: string;
  bars: readonly { value: number; tone: ChartTone }[];
}>;

/** Grouped columns (trend by month). Each group is one accessible element. */
export function ColumnChart({
  groups,
  height = 120,
  testID,
}: {
  groups: readonly ColumnGroup[];
  height?: number;
  testID?: string;
}) {
  const toneColor = useToneColor();
  const max = Math.max(0, ...groups.flatMap((g) => g.bars.map((b) => b.value)));
  return (
    <Row gap="xs" align="flex-end" testID={testID} style={{ minHeight: height + 24 }}>
      {groups.map((g) => (
        <Stack
          key={g.key}
          gap="xxs"
          accessible
          accessibilityLabel={g.accessibilityLabel}
          testID={testID ? `${testID}-${g.key}` : undefined}
          style={{ flex: 1, alignItems: 'center' }}
        >
          <Row gap="xxs" align="flex-end" style={{ height }}>
            {g.bars.map((b, i) => (
              <View
                key={i}
                style={{
                  width: 6,
                  height: (height * sharePercent(b.value, max)) / 100,
                  borderRadius: radius.sm,
                  backgroundColor: toneColor(b.tone),
                }}
              />
            ))}
          </Row>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {g.label}
          </Text>
        </Stack>
      ))}
    </Row>
  );
}
