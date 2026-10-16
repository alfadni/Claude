import { useMemo, useState } from 'react';

import { ALL_CURRENCIES, type CurrencyCode } from '@/domain';
import { Chip, Row, Stack, TextField } from '@/ui';

const COMMON: CurrencyCode[] = ['USD', 'SDG', 'EUR', 'SAR', 'AED', 'EGP', 'GBP', 'QAR', 'KWD'];

export function CurrencyPicker({
  value,
  onChange,
  label,
  searchLabel,
  preferred,
}: {
  value: CurrencyCode;
  onChange: (c: CurrencyCode) => void;
  label: string;
  searchLabel: string;
  preferred?: CurrencyCode | null;
}) {
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q) return ALL_CURRENCIES.filter((c) => c.includes(q)).slice(0, 24);
    const head = [preferred, value, ...COMMON].filter((c): c is CurrencyCode => !!c);
    return [...new Set(head)];
  }, [query, preferred, value]);
  return (
    <Stack gap="sm">
      <TextField
        label={searchLabel}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={3}
        testID="currency-search"
      />
      <Row
        gap="sm"
        style={{ flexWrap: 'wrap' }}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map((c) => (
          <Chip
            key={c}
            label={c}
            selected={c === value}
            onPress={() => onChange(c)}
            testID={`currency-${c}`}
          />
        ))}
      </Row>
    </Stack>
  );
}
