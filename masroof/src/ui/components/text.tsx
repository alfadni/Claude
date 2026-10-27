import { Text as RNText, type TextProps } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { typography } from '../tokens';

type Variant = keyof typeof typography;
type Tone =
  'default' | 'muted' | 'income' | 'expense' | 'transfer' | 'warning' | 'danger' | 'primary';

export type AppTextProps = TextProps & { variant?: Variant; tone?: Tone };

/**
 * All text goes through here. Font scaling (Dynamic Type) is always on, and
 * `textAlign: 'auto'` follows the writing direction in RTL.
 */
export function Text({ variant = 'body', tone = 'default', style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const color = {
    default: colors.text,
    muted: colors.textMuted,
    income: colors.income,
    expense: colors.expense,
    transfer: colors.transfer,
    warning: colors.warning,
    danger: colors.danger,
    primary: colors.primary,
  }[tone];
  return (
    <RNText
      allowFontScaling
      {...rest}
      style={[typography[variant], { color, textAlign: 'auto', writingDirection: 'auto' }, style]}
    />
  );
}
