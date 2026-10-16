import { Pressable, type PressableProps } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { MIN_TOUCH_TARGET, radius, spacing } from '../tokens';
import { Text } from './text';

export type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  selected?: boolean;
};

export function Button({
  label,
  variant = 'primary',
  selected,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const bg = { primary: colors.primary, secondary: colors.surface, danger: colors.danger }[variant];
  const fg = { primary: colors.onPrimary, secondary: colors.text, danger: colors.onDanger }[
    variant
  ];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      disabled={disabled}
      hitSlop={4}
      {...rest}
      style={(state) => [
        {
          minHeight: MIN_TOUCH_TARGET,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          backgroundColor: bg,
          borderWidth: variant === 'secondary' ? (selected ? 2 : 1) : 0,
          borderColor: selected ? colors.focus : colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <Text variant="bodyStrong" style={{ color: fg, textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  );
}
