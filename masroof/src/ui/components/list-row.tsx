import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { MIN_TOUCH_TARGET, spacing } from '../tokens';
import { Text } from './text';

export function ListRow({
  title,
  subtitle,
  icon,
  trailing,
  onPress,
  accessibilityLabel,
  testID,
}: {
  title: string;
  subtitle?: string | null;
  icon?: string | null;
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const body = (
    <View
      style={{
        minHeight: MIN_TOUCH_TARGET + 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      {icon ? (
        <Text variant="title" importantForAccessibility="no">
          {icon}
        </Text>
      ) : null}
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}
