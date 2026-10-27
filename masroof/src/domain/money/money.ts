import { err, invariant, ok, type Result } from '../shared/result';
import { exponentOf, type CurrencyCode } from './currency';

/**
 * An amount of money in integer minor units (cents, fils…).
 *
 * Never a float. `amountMinor` is always a safe integer; arithmetic that would
 * leave the safe range throws rather than silently losing precision.
 */
export type Money = Readonly<{ amountMinor: number; currency: CurrencyCode }>;

/** User-entered amounts are capped at 15 digits (minor units), per spec J2. */
export const MAX_INPUT_DIGITS = 15;
export const MAX_INPUT_MINOR = 10 ** MAX_INPUT_DIGITS - 1;

export function money(amountMinor: number, currency: CurrencyCode): Money {
  invariant(
    Number.isSafeInteger(amountMinor),
    `amountMinor must be a safe integer, got ${amountMinor}`,
  );
  exponentOf(currency); // validates the code at runtime too
  return Object.freeze({ amountMinor, currency });
}

export const zero = (currency: CurrencyCode): Money => money(0, currency);

function assertSameCurrency(a: Money, b: Money): void {
  invariant(a.currency === b.currency, `Currency mismatch: ${a.currency} vs ${b.currency}`);
}

function checked(n: number): number {
  invariant(Number.isSafeInteger(n), 'Money arithmetic overflowed the safe integer range');
  return n;
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(checked(a.amountMinor + b.amountMinor), a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(checked(a.amountMinor - b.amountMinor), a.currency);
}

export function negate(a: Money): Money {
  return money(a.amountMinor === 0 ? 0 : -a.amountMinor, a.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, m) => add(acc, m), zero(currency));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

export const equals = (a: Money, b: Money): boolean =>
  a.currency === b.currency && a.amountMinor === b.amountMinor;

export const isZero = (a: Money): boolean => a.amountMinor === 0;
export const isPositive = (a: Money): boolean => a.amountMinor > 0;
export const isNegative = (a: Money): boolean => a.amountMinor < 0;

/**
 * Split `total` across integer `ratios` without losing or inventing a minor
 * unit (largest-remainder method). The parts always sum to `total`.
 * Ties go to the earlier ratio, so results are deterministic.
 */
export function allocate(total: Money, ratios: readonly number[]): Money[] {
  invariant(ratios.length > 0, 'allocate needs at least one ratio');
  invariant(
    ratios.every((r) => Number.isSafeInteger(r) && r >= 0),
    'ratios must be non-negative integers',
  );
  const ratioSum = ratios.reduce((a, b) => a + b, 0);
  invariant(ratioSum > 0, 'ratios must not all be zero');

  const t = BigInt(total.amountMinor);
  const s = BigInt(ratioSum);
  const shares = ratios.map((r) => (t * BigInt(r)) / s); // truncates toward zero
  const remainders = ratios.map((r, i) => {
    const exact = t * BigInt(r);
    const rem = exact - (shares[i] as bigint) * s;
    return { i, rem: rem < 0n ? -rem : rem };
  });
  let leftover = t - shares.reduce((a, b) => a + b, 0n);
  const step = leftover < 0n ? -1n : 1n;
  remainders.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    if (ratios[i] === 0) continue;
    shares[i] = (shares[i] as bigint) + step;
    leftover -= step;
  }
  return shares.map((v) => money(Number(v), total.currency));
}

// ---------------------------------------------------------------------------
// Parsing user input
// ---------------------------------------------------------------------------

export type AmountParseError = 'empty' | 'invalid' | 'negative' | 'too_many_decimals' | 'too_large';

export type ParseOptions = {
  /** The user's decimal separator setting. Group separators are ignored. */
  decimalSeparator?: '.' | ',';
  allowNegative?: boolean;
};

const EASTERN_ARABIC_ZERO = 0x0660; // ٠
const PERSIAN_ZERO = 0x06f0; // ۰

/** Map Eastern Arabic / Persian digits and Arabic separators to ASCII. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) as number;
    if (code >= EASTERN_ARABIC_ZERO && code <= EASTERN_ARABIC_ZERO + 9) {
      out += String(code - EASTERN_ARABIC_ZERO);
    } else if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else if (ch !== '\u066C') {
      // U+066C is the Arabic thousands separator: dropped.
      // U+066B (Arabic decimal separator) is kept and resolved by the parser.
      out += ch;
    }
  }
  return out;
}

/**
 * Parse a typed amount ("1,234.50", Eastern Arabic "١٢٣", "12,5" with comma decimals) into
 * minor units using string arithmetic only — no floating point at any step.
 */
export function parseAmount(
  input: string,
  currency: CurrencyCode,
  options: ParseOptions = {},
): Result<Money, AmountParseError> {
  const decimalSeparator = options.decimalSeparator ?? '.';
  const groupSeparators =
    decimalSeparator === '.' ? [',', ' ', '\u00A0', "'"] : ['.', ' ', '\u00A0', "'"];

  let s = normalizeDigits(input).trim();
  if (s === '') return err('empty');

  let negative = false;
  if (s.startsWith('-') || s.startsWith('\u2212')) {
    negative = true;
    s = s.slice(1).trim();
  }
  for (const g of groupSeparators) s = s.split(g).join('');
  s = s.split('\u066B').join(decimalSeparator);
  if (s === '') return err('invalid');

  const parts = s.split(decimalSeparator);
  if (parts.length > 2) return err('invalid');
  const whole = parts[0] ?? '';
  const frac = parts[1] ?? '';
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac) || (whole === '' && frac === '')) {
    return err('invalid');
  }

  const exponent = exponentOf(currency);
  const fracTrimmed = frac.replace(/0+$/, '');
  if (fracTrimmed.length > exponent) return err('too_many_decimals');

  const digits = (whole + frac.padEnd(exponent, '0').slice(0, exponent)).replace(/^0+(?=\d)/, '');
  if (digits.replace(/^0+/, '').length > MAX_INPUT_DIGITS) return err('too_large');

  const amountMinor = Number(digits === '' ? '0' : digits);
  if (negative && amountMinor !== 0) {
    if (!options.allowNegative) return err('negative');
    return ok(money(-amountMinor, currency));
  }
  return ok(money(amountMinor, currency));
}

export type PositiveAmountError = AmountParseError | 'zero';

/** Transaction amounts: strictly positive, ≤ 15 digits. */
export function parsePositiveAmount(
  input: string,
  currency: CurrencyCode,
  options: Omit<ParseOptions, 'allowNegative'> = {},
): Result<Money, PositiveAmountError> {
  const r = parseAmount(input, currency, options);
  if (!r.ok) return r;
  if (r.value.amountMinor === 0) return err('zero');
  return r;
}

/** Plain, locale-free major-unit string ("-1234.50"). For CSV and storage. */
export function toDecimalString(m: Money): string {
  const exponent = exponentOf(m.currency);
  const negative = m.amountMinor < 0;
  const digits = String(Math.abs(m.amountMinor)).padStart(exponent + 1, '0');
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const frac = exponent === 0 ? '' : `.${digits.slice(-exponent)}`;
  return `${negative ? '-' : ''}${whole}${frac}`;
}
