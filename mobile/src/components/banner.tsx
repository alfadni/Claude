import { Pressable, StyleSheet, Text, View } from 'react-native';

import { space, usePalette } from '@/lib/theme';

type Tone = 'info' | 'warn' | 'error';

export function Banner({
  tone,
  title,
  message,
  actionLabel,
  onAction,
  testID,
}: {
  tone: Tone;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const c = usePalette();
  const bg = { info: c.infoBg, warn: c.warnBg, error: c.errorBg }[tone];
  const fg = { info: c.infoText, warn: c.warnText, error: c.errorText }[tone];
  return (
    <View
      testID={testID}
      accessibilityRole={tone === 'info' ? undefined : 'alert'}
      style={[styles.box, { backgroundColor: bg }]}>
      <View style={styles.text}>
        <Text style={[styles.title, { color: fg }]}>{title}</Text>
        {message ? <Text style={[styles.message, { color: fg }]}>{message}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8} style={styles.action}>
          <Text style={[styles.actionText, { color: fg }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: space.md, gap: space.md },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '600' },
  message: { fontSize: 13, lineHeight: 18 },
  action: { paddingVertical: space.xs, paddingHorizontal: space.sm },
  actionText: { fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
});
