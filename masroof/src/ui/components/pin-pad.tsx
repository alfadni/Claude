import { Pressable, View } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { MIN_TOUCH_TARGET, radius, spacing } from '../tokens';
import { Text } from './text';

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
] as const;

/**
 * PIN entry: dots show progress without revealing digits; screen readers hear
 * "digit n of total entered", never the digit. Grid stays LTR like a phone keypad.
 */
export function PinPad({
  length,
  maxLength = 6,
  onDigit,
  onDelete,
  arabicDigits,
  labels,
  disabled = false,
  testID = 'pin-pad',
}: {
  length: number;
  maxLength?: number;
  onDigit: (d: string) => void;
  onDelete: () => void;
  arabicDigits: boolean;
  labels: { entered: string; delete: string };
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const glyph = (d: string) => (arabicDigits ? String.fromCharCode(0x0660 + Number(d)) : d);
  return (
    <View style={{ gap: spacing.lg, alignItems: 'center' }} testID={testID}>
      <View
        style={{ flexDirection: 'row', gap: spacing.md, direction: 'ltr' }}
        accessible
        accessibilityLabel={labels.entered}
        accessibilityLiveRegion="polite"
        testID={`${testID}-dots`}
      >
        {Array.from({ length: maxLength }, (_, i) => (
          <View
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              borderWidth: 2,
              borderColor: colors.text,
              backgroundColor: i < length ? colors.text : 'transparent',
            }}
          />
        ))}
      </View>
      <View style={{ gap: spacing.sm, direction: 'ltr', width: '100%', maxWidth: 320 }}>
        {ROWS.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', gap: spacing.sm }}>
            {row.map((k, c) =>
              k === '' ? (
                <View key={`e${c}`} style={{ flex: 1 }} />
              ) : (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={k === 'del' ? labels.delete : k}
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => (k === 'del' ? onDelete() : length < maxLength && onDigit(k))}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: MIN_TOUCH_TARGET + 12,
                    borderRadius: radius.lg,
                    backgroundColor: k === 'del' ? 'transparent' : colors.surface,
                    borderWidth: k === 'del' ? 0 : 1,
                    borderColor: colors.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
                  })}
                >
                  <Text variant="title">{k === 'del' ? '⌫' : glyph(k)}</Text>
                </Pressable>
              ),
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
