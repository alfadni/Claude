import { Pressable, View } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { MIN_TOUCH_TARGET, radius, spacing } from '../tokens';
import { Text } from './text';

export type KeypadKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'decimal'
  | '+'
  | '-'
  | '*'
  | '/'
  | 'back'
  | 'clear';

const ROWS: KeypadKey[][] = [
  ['7', '8', '9', '/'],
  ['4', '5', '6', '*'],
  ['1', '2', '3', '-'],
  ['decimal', '0', 'back', '+'],
];

/**
 * Calculator keypad. Digit glyphs follow the numerals setting; the grid is
 * deliberately NOT mirrored in RTL (phone keypads keep 1-2-3 left to right in
 * Arabic locales too), so it opts out with direction: 'ltr'.
 */
export function Keypad({
  onKey,
  decimalSeparator,
  arabicDigits,
  labels,
}: {
  onKey: (key: KeypadKey) => void;
  decimalSeparator: '.' | ',';
  arabicDigits: boolean;
  labels: Record<'plus' | 'minus' | 'times' | 'divide' | 'decimal' | 'backspace' | 'clear', string>;
}) {
  const { colors } = useTheme();
  const glyph = (k: KeypadKey): string => {
    if (/^\d$/.test(k)) return arabicDigits ? String.fromCharCode(0x0660 + Number(k)) : k;
    return {
      decimal: arabicDigits ? '\u066B' : decimalSeparator,
      '+': '+',
      '-': '\u2212',
      '*': '×',
      '/': '÷',
      back: '⌫',
      clear: 'C',
    }[k as 'decimal'];
  };
  const a11y = (k: KeypadKey): string =>
    /^\d$/.test(k)
      ? k
      : {
          decimal: labels.decimal,
          '+': labels.plus,
          '-': labels.minus,
          '*': labels.times,
          '/': labels.divide,
          back: labels.backspace,
          clear: labels.clear,
        }[k as 'decimal'];

  return (
    <View style={{ direction: 'ltr', gap: spacing.xs }} testID="keypad">
      {ROWS.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.xs }}>
          {row.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={a11y(k)}
              onPress={() => onKey(k)}
              onLongPress={k === 'back' ? () => onKey('clear') : undefined}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: MIN_TOUCH_TARGET + 4,
                borderRadius: radius.md,
                backgroundColor: /^\d$/.test(k) ? colors.surface : colors.surfaceRaised,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text variant="title">{glyph(k)}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}
