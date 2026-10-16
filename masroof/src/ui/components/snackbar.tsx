import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { radius, spacing } from '../tokens';
import { Button } from './button';
import { Row } from './layout';
import { Text } from './text';

/** Bottom snackbar with an optional action (Undo). Announced to screen readers. */
export function Snackbar({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(message);
  }, [message]);
  return (
    <View
      testID="snackbar"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        start: spacing.lg,
        end: spacing.lg,
        bottom: spacing.xl + 72,
        borderRadius: radius.md,
        backgroundColor: colors.surfaceRaised,
        borderColor: colors.border,
        borderWidth: 1,
        padding: spacing.md,
      }}
    >
      <Row gap="md">
        <Text style={{ flex: 1 }}>{message}</Text>
        {action ? (
          <Button label={action.label} variant="secondary" onPress={action.onPress} />
        ) : null}
      </Row>
    </View>
  );
}
