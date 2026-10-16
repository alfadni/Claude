import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HORIZONS, type Horizon } from '@/api/types';
import { space, usePalette } from '@/lib/theme';

const LABELS: Record<Horizon, string> = { 7: '7D', 30: '30D', 90: '90D', 180: '180D', 365: '1Y' };
const A11Y: Record<Horizon, string> = {
  7: '7 days',
  30: '30 days',
  90: '90 days',
  180: '180 days',
  365: '1 year',
};

export function HorizonPicker({ value, onChange }: { value: Horizon; onChange: (h: Horizon) => void }) {
  const c = usePalette();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
      {HORIZONS.map((h) => {
        const selected = h === value;
        return (
          <Pressable
            key={h}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`Forecast ${A11Y[h]} ahead`}
            onPress={() => onChange(h)}
            hitSlop={4}
            style={[styles.item, selected && { backgroundColor: c.accent }]}>
            <Text style={[styles.label, { color: selected ? '#FFFFFF' : c.textMuted }]}>{LABELS[h]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 3 },
  item: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  label: { fontSize: 14, fontWeight: '600', paddingHorizontal: space.xs },
});
