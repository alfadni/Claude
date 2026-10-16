import { View } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { radius, spacing } from '../tokens';
import { Button } from './button';
import { Row } from './layout';
import { Text } from './text';

/** Inline notice. Tone adds an icon so meaning never depends on colour. */
export function Banner({
  tone = 'info',
  message,
  action,
  testID,
}: {
  tone?: 'info' | 'warning' | 'danger';
  message: string;
  action?: { label: string; onPress: () => void };
  testID?: string;
}) {
  const { colors } = useTheme();
  const icon = { info: 'ℹ️', warning: '⚠️', danger: '⛔' }[tone];
  const textTone = tone === 'info' ? 'default' : tone;
  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor:
          tone === 'info' ? colors.border : colors[tone === 'warning' ? 'warning' : 'danger'],
        backgroundColor: colors.surface,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <Row gap="sm" align="flex-start">
        <Text importantForAccessibility="no">{icon}</Text>
        <Text
          tone={textTone}
          style={{ flex: 1 }}
          accessibilityRole={tone === 'info' ? 'text' : 'alert'}
        >
          {message}
        </Text>
      </Row>
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </View>
  );
}
