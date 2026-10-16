import { View } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { radius } from '../tokens';

export type ProgressTone = 'ok' | 'warning' | 'over' | 'neutral';

/**
 * Horizontal progress (budgets, goals). Width follows the writing direction,
 * and the value is exposed to screen readers; colour is never the only
 * signal (callers show the status as text too).
 */
export function ProgressBar({
  percent,
  tone = 'neutral',
  label,
  testID,
}: {
  percent: number;
  tone?: ProgressTone;
  label: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const fill = {
    ok: colors.income,
    warning: colors.warning,
    over: colors.danger,
    neutral: colors.primary,
  }[tone];
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.border }}
    >
      <View
        style={{
          width: `${clamped === 0 ? 0 : Math.max(2, clamped)}%`,
          height: 8,
          borderRadius: radius.pill,
          backgroundColor: fill,
        }}
      />
    </View>
  );
}
