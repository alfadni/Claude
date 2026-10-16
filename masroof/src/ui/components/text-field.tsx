import { TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { MIN_TOUCH_TARGET, radius, spacing, typography } from '../tokens';
import { Text } from './text';

export function TextField({
  label,
  error,
  hint,
  style,
  ...rest
}: TextInputProps & { label: string; error?: string | null; hint?: string | null }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint ?? undefined}
        placeholderTextColor={colors.textMuted}
        allowFontScaling
        {...rest}
        style={[
          typography.body,
          {
            minHeight: MIN_TOUCH_TARGET,
            paddingHorizontal: spacing.md,
            borderRadius: radius.md,
            borderWidth: error ? 2 : 1,
            borderColor: error ? colors.danger : colors.border,
            backgroundColor: colors.surface,
            color: colors.text,
            textAlign: 'auto',
            writingDirection: 'auto',
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
