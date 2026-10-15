import { err, invariant, ok, type Result } from '../shared/result';
import { exponentOf, type CurrencyCode } from './currency';
import { money, type Money } from './money';

/**
 * Exchange rates are positive decimal strings ("3.6725", "0.00166").
 * They are never held as floats: conversion runs in BigInt.
 * Meaning: 1 unit of `from` = `rate` units of `to`.
 */
export type DecimalRate = string & { readonly __brand: 'DecimalRate' };

export const MAX_RATE_FRACTION_DIGITS = 12;
const RATE_PATTERN = /^(\d{1,12})(?:\.(\d{1,12}))?$/;

export type RateError = 'invalid' | 'zero';

export function parseRate(input: string): Result<DecimalRate, RateError> {
  const s = input.trim();
  const m = RATE_PATTERN.exec(s);
  if (!m) return err('invalid');
  const whole = (m[1] as string).replace(/^0+(?=\d)/, '');
  const frac = (m[2] ?? '').replace(/0+$/, '');
  if (/^0*$/.test(whole) && frac === '') return err('zero');
  return ok((frac ? `${whole}.${frac}` : whole) as DecimalRate);
}

function rateToFraction(rate: DecimalRate): { num: bigint; den: bigint } {
  const [whole, frac = ''] = rate.split('.');
  return { num: BigInt(`${whole}${frac}`), den: 10n ** BigInt(frac.length) };
}

/** Integer division rounded half-to-even (banker's rounding). */
export function divRoundHalfEven(n: bigint, d: bigint): bigint {
  invariant(d !== 0n, 'division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const negative = n < 0n;
  const a = negative ? -n : n;
  let q = a / d;
  const r = a - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && q % 2n === 1n)) q += 1n;
  return negative ? -q : q;
}

/** Convert `amount` into `to` currency at `rate`, rounding half-even. */
export function convert(amount: Money, rate: DecimalRate, to: CurrencyCode): Money {
  const { num, den } = rateToFraction(rate);
  const fromExp = BigInt(exponentOf(amount.currency));
  const toExp = BigInt(exponentOf(to));
  const n = BigInt(amount.amountMinor) * num * 10n ** toExp;
  const d = den * 10n ** fromExp;
  const result = divRoundHalfEven(n, d);
  invariant(
    result <= BigInt(Number.MAX_SAFE_INTEGER) && result >= BigInt(Number.MIN_SAFE_INTEGER),
    'Converted amount exceeds the safe integer range',
  );
  return money(Number(result), to);
}

/**
 * Rate implied by two legs of a cross-currency transfer (spec J4): the user
 * types both amounts once; the rate is derived, never typed twice.
 */
export function deriveRate(
  from: Money,
  to: Money,
  fractionDigits: number = MAX_RATE_FRACTION_DIGITS,
): DecimalRate {
  invariant(from.amountMinor > 0 && to.amountMinor > 0, 'deriveRate needs two positive legs');
  const fromExp = BigInt(exponentOf(from.currency));
  const toExp = BigInt(exponentOf(to.currency));
  const scale = 10n ** BigInt(fractionDigits);
  const scaled = divRoundHalfEven(
    BigInt(to.amountMinor) * 10n ** fromExp * scale,
    BigInt(from.amountMinor) * 10n ** toExp,
  );
  const digits = scaled.toString().padStart(fractionDigits + 1, '0');
  const whole = digits.slice(0, digits.length - fractionDigits);
  const frac = digits.slice(digits.length - fractionDigits).replace(/0+$/, '');
  const text = frac ? `${whole}.${frac}` : whole;
  // A rate so small it rounds to zero at 12 digits is not representable.
  invariant(!/^0(\.0*)?$/.test(text), 'Derived rate underflows the supported precision');
  return text as DecimalRate;
}
