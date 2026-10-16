import { Row } from './layout';
import { Chip } from './chip';

export type SegmentOption<T extends string> = { value: T; label: string };

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Row
      gap="sm"
      style={{ flexWrap: 'wrap' }}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          selected={o.value === value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </Row>
  );
}
