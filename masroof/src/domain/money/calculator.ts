import { err, ok, type Result } from '../shared/result';
import { exponentOf, type CurrencyCode } from './currency';
import { divRoundHalfEven } from './fx';
import { MAX_INPUT_MINOR, money, normalizeDigits, type Money } from './money';

/**
 * Keypad calculator for quick add (spec §5.3: "12+8.5").
 *
 * Exact rational arithmetic in BigInt: every operand is num/den with
 * den = 10^k, results are rounded half-even to the currency's minor unit only
 * once, at the end. Supports + \u2212 × ÷ with normal precedence; no parentheses
 * (the keypad has none).
 */
export type CalcError =
  | 'empty'
  | 'invalid'
  | 'division_by_zero'
  | 'negative'
  | 'zero'
  | 'too_many_decimals'
  | 'too_large';

type Rational = { num: bigint; den: bigint };
type Op = '+' | '-' | '*' | '/';

const OPERATORS: Record<string, Op> = {
  '+': '+',
  '-': '-',
  '\u2212': '-',
  '*': '*',
  '×': '*',
  x: '*',
  '/': '/',
  '÷': '/',
};

export const KEYPAD_OPERATORS = ['+', '\u2212', '×', '÷'] as const;
const MAX_OPERAND_DECIMALS = 12;

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function normalize(r: Rational): Rational {
  if (r.den < 0n) r = { num: -r.num, den: -r.den };
  const g = gcd(r.num, r.den) || 1n;
  return { num: r.num / g, den: r.den / g };
}

function apply(a: Rational, op: Op, b: Rational): Rational | 'division_by_zero' {
  switch (op) {
    case '+':
      return normalize({ num: a.num * b.den + b.num * a.den, den: a.den * b.den });
    case '-':
      return normalize({ num: a.num * b.den - b.num * a.den, den: a.den * b.den });
    case '*':
      return normalize({ num: a.num * b.num, den: a.den * b.den });
    case '/':
      if (b.num === 0n) return 'division_by_zero';
      return normalize({ num: a.num * b.den, den: a.den * b.num });
  }
}

type Token = { kind: 'num'; value: Rational; decimals: number } | { kind: 'op'; op: Op };

function tokenize(input: string, decimalSeparator: '.' | ','): Token[] | 'invalid' {
  const s = normalizeDigits(input)
    .replace(/\s+/g, '')
    .split('\u066B')
    .join(decimalSeparator)
    .split('\u066C')
    .join('');
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    const op = OPERATORS[ch];
    if (op) {
      tokens.push({ kind: 'op', op });
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && /[0-9]/.test(s[j] as string)) j++;
    let whole = s.slice(i, j);
    let frac = '';
    if (s[j] === decimalSeparator) {
      let k = j + 1;
      while (k < s.length && /[0-9]/.test(s[k] as string)) k++;
      frac = s.slice(j + 1, k);
      j = k;
    }
    if (j === i || (whole === '' && frac === '')) return 'invalid';
    if (frac.length > MAX_OPERAND_DECIMALS) return 'invalid';
    whole = whole === '' ? '0' : whole;
    tokens.push({
      kind: 'num',
      value: normalize({ num: BigInt(whole + frac), den: 10n ** BigInt(frac.length) }),
      decimals: frac.replace(/0+$/, '').length,
    });
    i = j;
  }
  return tokens;
}

/** Evaluate an expression to an exact rational, or report why it can't be. */
function evaluate(tokens: Token[]): Rational | CalcError {
  if (tokens.length === 0) return 'empty';
  // Allow one leading unary minus ("-5" → negative, reported later).
  let pos = 0;
  let leadingNegative = false;
  if (tokens[0]?.kind === 'op' && tokens[0].op === '-') {
    leadingNegative = true;
    pos = 1;
  }
  // Expect num (op num)* — strictly alternating; "12++" or "12+" is invalid.
  const nums: Rational[] = [];
  const ops: Op[] = [];
  for (let expectNum = true; pos < tokens.length; pos++, expectNum = !expectNum) {
    const t = tokens[pos] as Token;
    if (expectNum !== (t.kind === 'num')) return 'invalid';
    if (t.kind === 'num') nums.push(t.value);
    else ops.push(t.op);
  }
  if (nums.length === 0 || nums.length !== ops.length + 1) return 'invalid';
  if (leadingNegative)
    nums[0] = { num: -(nums[0] as Rational).num, den: (nums[0] as Rational).den };

  // Precedence: fold × ÷ first, then + \u2212.
  const addNums: Rational[] = [nums[0] as Rational];
  const addOps: Op[] = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k] as Op;
    const rhs = nums[k + 1] as Rational;
    if (op === '*' || op === '/') {
      const r = apply(addNums.pop() as Rational, op, rhs);
      if (r === 'division_by_zero') return r;
      addNums.push(r);
    } else {
      addOps.push(op);
      addNums.push(rhs);
    }
  }
  let acc = addNums[0] as Rational;
  for (let k = 0; k < addOps.length; k++) {
    acc = apply(acc, addOps[k] as Op, addNums[k + 1] as Rational) as Rational;
  }
  return acc;
}

export function isExpression(input: string): boolean {
  const s = input.trim();
  return [...s.slice(1)].some((c) => c in OPERATORS);
}

/**
 * Evaluate keypad input to a strictly positive amount in `currency`.
 * A plain number with more decimals than the currency allows is rejected
 * (never silently rounded); a computed result like 10 ÷ 3 is rounded
 * half-even to the minor unit.
 */
export function evaluateAmount(
  input: string,
  currency: CurrencyCode,
  options: { decimalSeparator?: '.' | ',' } = {},
): Result<Money, CalcError> {
  const tokens = tokenize(input, options.decimalSeparator ?? '.');
  if (tokens === 'invalid') return err('invalid');
  const exponent = exponentOf(currency);
  const operands = tokens.filter((t) => t.kind === 'num');
  if (operands.length === 1 && (operands[0] as { decimals: number }).decimals > exponent) {
    return err('too_many_decimals');
  }

  const value = evaluate(tokens);
  if (typeof value === 'string') return err(value);

  const minor = divRoundHalfEven(value.num * 10n ** BigInt(exponent), value.den);
  if (minor < 0n) return err('negative');
  if (minor === 0n) return err('zero');
  if (minor > BigInt(MAX_INPUT_MINOR)) return err('too_large');
  return ok(money(Number(minor), currency));
}
