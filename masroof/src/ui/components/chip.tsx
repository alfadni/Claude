import { Pressable, type PressableProps } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { MIN_TOUCH_TARGET, radius, spacing } from '../tokens';
import { Text } from './text';

/** Selectable pill (category, account, date choices). Selection is shown by border + weight + state, not colour alone. */
export function Chip({
  label,
  icon,
  selected = false,
  role = 'radio',
  ...rest
}: Omit<PressableProps, 'children'> & {
  label: string;
  icon?: string | null;
  selected?: boolean;
  role?: 'radio' | 'button' | 'checkbox';
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={role === 'button' ? { selected } : { checked: selected }}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {icon ? <Text importantForAccessibility="no">{icon}</Text> : null}
      <Text variant={selected ? 'bodyStrong' : 'body'}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}
