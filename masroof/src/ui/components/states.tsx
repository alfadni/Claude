import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '../theme/theme-context';
import { spacing } from '../tokens';
import { Button } from './button';
import { Stack } from './layout';
import { Text } from './text';

type Action = { label: string; onPress: () => void };

/** Every screen designs its empty, loading and error states (spec §9). */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: Action;
}) {
  return (
    <Stack gap="md" style={{ alignItems: 'stretch', paddingVertical: spacing.xl }}>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text tone="muted">{body}</Text> : null}
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
    </Stack>
  );
}

export function ErrorState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: Action;
}) {
  return (
    <Stack gap="md">
      {/* The message itself is the alert, so the action button stays separately focusable. */}
      <Text
        variant="title"
        tone="danger"
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        {title}
      </Text>
      <Text>{body}</Text>
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </Stack>
  );
}

export function LoadingState({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}
      accessibilityLabel={label}
    >
      <ActivityIndicator color={colors.primary} />
      <Text tone="muted">{label}</Text>
    </View>
  );
}
