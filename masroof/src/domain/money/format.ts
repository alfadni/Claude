import { exponentOf } from './currency';
import type { Money } from './money';

/**
 * Deterministic money formatting. Intl support differs between Hermes builds
 * (numberingSystem, grouping), so separators and digit shapes are applied here
 * from the user's settings instead.
 */
export type NumberFormat = Readonly<{
  decimalSeparator: '.' | ',';
  groupSeparator: ',' | '.' | ' ' | '\u00A0' | "'" | '';
}>;

export const NUMBER_FORMATS = {
  en: { decimalSeparator: '.', groupSeparator: ',' },
  eu: { decimalSeparator: ',', groupSeparator: '.' },
  space: { decimalSeparator: ',', groupSeparator: '\u00A0' },
  plain: { decimalSeparator: '.', groupSeparator: '' },
} as const satisfies Record<string, NumberFormat>;

export type NumberFormatId = keyof typeof NUMBER_FORMATS;

export type Numerals = 'latn' | 'arab';

export type FormatOptions = Readonly<{
  format?: NumberFormat;
  numerals?: Numerals;
  /** 'code' → "1,234.50 USD"; 'none' → "1,234.50". */
  currencyDisplay?: 'code' | 'none';
  /** auto: minus sign only for negatives; always: plus/minus on every non-zero amount (colour-blind safe). */
  signDisplay?: 'auto' | 'always';
}>;

const MINUS = '\u2212';

export function toArabicIndicDigits(s: string): string {
  return s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}

function group(whole: string, sep: string): string {
  if (sep === '') return whole;
  let out = '';
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += sep;
    out += whole[i];
  }
  return out;
}

export function formatMoney(m: Money, options: FormatOptions = {}): string {
  const fmt = options.format ?? NUMBER_FORMATS.en;
  const numerals = options.numerals ?? 'latn';
  const exponent = exponentOf(m.currency);

  const abs = String(Math.abs(m.amountMinor)).padStart(exponent + 1, '0');
  const whole = exponent === 0 ? abs : abs.slice(0, -exponent);
  const frac = exponent === 0 ? '' : abs.slice(-exponent);

  let decimalSep: string = fmt.decimalSeparator;
  let groupSep: string = fmt.groupSeparator;
  if (numerals === 'arab') {
    // Arabic-Indic digits pair with the Arabic separators.
    decimalSep = '\u066B';
    groupSep = groupSep === '' ? '' : '\u066C';
  }

  let body = group(whole, groupSep) + (frac ? decimalSep + frac : '');
  if (numerals === 'arab') body = toArabicIndicDigits(body);

  let sign = '';
  if (m.amountMinor < 0) sign = MINUS;
  else if (options.signDisplay === 'always' && m.amountMinor > 0) sign = '+';

  const code = options.currencyDisplay === 'none' ? '' : `\u00A0${m.currency}`;
  return `${sign}${body}${code}`;
}
