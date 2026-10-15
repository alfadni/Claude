import { formatMoney, type FormatOptions, type Money } from '@/domain';

import { Text, type AppTextProps } from './text';

export type AmountKind = 'income' | 'expense' | 'transfer' | 'neutral';

const ICON: Record<AmountKind, string> = { income: '▲', expense: '▼', transfer: '⇄', neutral: '' };

/**
 * Money on screen. Colour is never the only signal: the sign and an arrow
 * glyph are shown too. Screen readers get a full sentence via
 * `spokenLabel` (e.g. "Expense 12.50 USD") instead of glyphs.
 */
export function AmountText({
  money,
  kind,
  format,
  spokenLabel,
  ...rest
}: Omit<AppTextProps, 'children' | 'tone'> & {
  money: Money;
  kind: AmountKind;
  format?: FormatOptions;
  spokenLabel: (formatted: string) => string;
}) {
  const signed =
    kind === 'expense'
      ? { ...money, amountMinor: -Math.abs(money.amountMinor) }
      : kind === 'income'
        ? { ...money, amountMinor: Math.abs(money.amountMinor) }
        : money;
  const text = formatMoney(signed, {
    signDisplay: kind === 'income' ? 'always' : 'auto',
    ...format,
  });
  const plain = formatMoney({ ...money, amountMinor: Math.abs(money.amountMinor) }, format);
  const tone = kind === 'neutral' ? 'default' : kind;
  return (
    <Text {...rest} tone={tone} accessibilityLabel={spokenLabel(plain)} accessible>
      {ICON[kind] ? `${ICON[kind]} ` : ''}
      {text}
    </Text>
  );
}
