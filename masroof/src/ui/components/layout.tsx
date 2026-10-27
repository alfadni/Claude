import type { ReactNode } from 'react';
import { ScrollView, View, type ViewProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../theme/theme-context';
import { spacing } from '../tokens';

type Gap = keyof typeof spacing;

/**
 * Layout primitives. `flexDirection: 'row'` is mirrored automatically by React
 * Native when RTL is active, and all padding/margins are logical
 * (start/end), so screens built from these need no RTL special-casing.
 */
export function Row({
  gap = 'sm',
  align = 'center',
  style,
  ...rest
}: ViewProps & { gap?: Gap; align?: ViewStyle['alignItems'] }) {
  return (
    <View
      {...rest}
      style={[{ flexDirection: 'row', alignItems: align, gap: spacing[gap] }, style]}
    />
  );
}

export function Stack({ gap = 'md', style, ...rest }: ViewProps & { gap?: Gap }) {
  return <View {...rest} style={[{ flexDirection: 'column', gap: spacing[gap] }, style]} />;
}

export function Screen({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  const { colors } = useTheme();
  const inner = { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.lg };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView contentContainerStyle={inner}>{children}</ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ style, ...rest }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 16,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        style,
      ]}
    />
  );
}
