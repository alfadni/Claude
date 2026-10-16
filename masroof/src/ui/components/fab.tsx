import { Pressable } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { spacing } from '../tokens';
import { Text } from './text';

/** Floating add button, anchored to the logical end edge (mirrors in RTL). */
export function Fab({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        end: spacing.xl,
        bottom: spacing.xl,
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
        elevation: 4,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      })}
    >
      <Text variant="display" style={{ color: colors.onPrimary, lineHeight: 36 }}>
        +
      </Text>
    </Pressable>
  );
}
