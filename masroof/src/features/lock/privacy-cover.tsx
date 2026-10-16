import { View } from 'react-native';

import { Text, useTheme } from '@/ui';

/** Covers balances while the app is not active, so the app-switcher snapshot shows nothing (spec 7). */
export function PrivacyCover({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID="privacy-cover"
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="display">🔒 {label}</Text>
    </View>
  );
}
