import {
  add,
  allocate,
  ALL_CURRENCIES,
  compare,
  equals,
  exponentOf,
  InvariantError,
  isCurrencyCode,
  isNegative,
  isPositive,
  isZero,
  money,
  negate,
  normalizeDigits,
  parseAmount,
  parsePositiveAmount,
  subtract,
  sum,
  toDecimalString,
  zero,
  type CurrencyCode,
} from '@/domain';

describe('currency table', () => {
  it.each([
    ['USD', 2],
    ['SDG', 2],
    ['JPY', 0],
    ['KRW', 0],
    ['KWD', 3],
    ['BHD', 3],
    ['IQD', 3],
    ['CLF', 4],
  ] as const)('%s has exponent %i', (code, exp) => {
    expect(exponentOf(code)).toBe(exp);
  });

  it('validates codes', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode('XXX')).toBe(false);
    expect(ALL_CURRENCIES.length).toBeGreaterThan(150);
    expect([...ALL_CURRENCIES].sort()).toEqual(ALL_CURRENCIES);
  });

  it('rejects a forged code at runtime', () => {
    expect(() => exponentOf('ZZZ' as CurrencyCode)).toThrow(RangeError);
  });
});

describe('Money arithmetic', () => {
  const usd = (n: number) => money(n, 'USD');

  it('adds, subtracts, negates and compares', () => {
    expect(add(usd(1050), usd(25))).toEqual(usd(1075));
    expect(subtract(usd(100), usd(250))).toEqual(usd(-150));
    expect(negate(usd(5))).toEqual(usd(-5));
    expect(negate(usd(0)).amountMinor).toBe(0); // never -0
    expect(Object.is(negate(usd(0)).amountMinor, -0)).toBe(false);
    expect(compare(usd(1), usd(2))).toBe(-1);
    expect(compare(usd(2), usd(2))).toBe(0);
    expect(compare(usd(3), usd(2))).toBe(1);
    expect(equals(usd(1), usd(1))).toBe(true);
    expect(equals(usd(1), money(1, 'EUR'))).toBe(false);
    expect(isZero(zero('USD'))).toBe(true);
    expect(isPositive(usd(1))).toBe(true);
    expect(isNegative(usd(-1))).toBe(true);
  });

  it('sums a list and an empty list', () => {
    expect(sum([usd(1), usd(2), usd(3)], 'USD')).toEqual(usd(6));
    expect(sum([], 'USD')).toEqual(usd(0));
  });

  it('avoids the classic float error 0.1 + 0.2', () => {
    expect(add(usd(10), usd(20)).amountMinor).toBe(30);
  });

  it('refuses mixed currencies', () => {
    expect(() => add(usd(1), money(1, 'SDG'))).toThrow(InvariantError);
    expect(() => compare(usd(1), money(1, 'SDG'))).toThrow(InvariantError);
  });

  it('refuses non-integer or unsafe amounts', () => {
    expect(() => money(1.5, 'USD')).toThrow(InvariantError);
    expect(() => money(Number.NaN, 'USD')).toThrow(InvariantError);
    expect(() => money(2 ** 53, 'USD')).toThrow(InvariantError);
  });

  it('throws instead of overflowing', () => {
    const big = usd(Number.MAX_SAFE_INTEGER);
    expect(() => add(big, usd(1))).toThrow(InvariantError);
  });

  it('is immutable', () => {
    const m = usd(1);
    expect(Object.isFrozen(m)).toBe(true);
  });
});

describe('allocate', () => {
  it('splits 100 three ways without losing a cent', () => {
    const parts = allocate(money(100, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([34, 33, 33]);
  });

  it('honours ratios (J3: $123 → 80/43)', () => {
    const parts = allocate(money(12300, 'USD'), [80, 43]);
    expect(parts.map((p) => p.amountMinor)).toEqual([8000, 4300]);
  });

  it('gives nothing to zero ratios', () => {
    const parts = allocate(money(5, 'JPY'), [0, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([0, 3, 2]);
  });

  it('handles negative totals', () => {
    const parts = allocate(money(-100, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([-34, -33, -33]);
    expect(parts.reduce((a, p) => a + p.amountMinor, 0)).toBe(-100);
  });

  it('always sums to the total (property check)', () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let i = 0; i < 500; i++) {
      const total = (rand() % 1_000_000) - 500_000;
      const ratios = Array.from({ length: (rand() % 6) + 1 }, () => rand() % 100);
      if (!ratios.some((r) => r > 0)) ratios[0] = 1;
      const parts = allocate(money(total, 'USD'), ratios);
      expect(parts.reduce((a, p) => a + p.amountMinor, 0)).toBe(total);
    }
  });

  it('rejects invalid ratios', () => {
    expect(() => allocate(money(1, 'USD'), [])).toThrow(InvariantError);
    expect(() => allocate(money(1, 'USD'), [0, 0])).toThrow(InvariantError);
    expect(() => allocate(money(1, 'USD'), [-1, 2])).toThrow(InvariantError);
    expect(() => allocate(money(1, 'USD'), [0.5])).toThrow(InvariantError);
  });
});

describe('parseAmount', () => {
  const p = (s: string, c: CurrencyCode = 'USD', o = {}) => parseAmount(s, c, o);
  const minor = (s: string, c: CurrencyCode = 'USD', o = {}) => {
    const r = p(s, c, o);
    if (!r.ok) throw new Error(`expected ok for ${s}, got ${r.error}`);
    return r.value.amountMinor;
  };

  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['0.01', 1],
    ['.5', 50],
    ['12.', 1200],
    ['1,234.56', 123456],
    ['  7  ', 700],
    ['007.10', 710],
    ['12.500', 1250], // trailing zeros beyond exponent are harmless
  ])('USD %p → %i', (s, expected) => {
    expect(minor(s)).toBe(expected);
  });

  it('respects currency exponents', () => {
    expect(minor('1500', 'JPY')).toBe(1500);
    expect(minor('1.250', 'KWD')).toBe(1250);
    expect(p('1.5', 'JPY')).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(p('1.2345', 'KWD')).toEqual({ ok: false, error: 'too_many_decimals' });
  });

  it('supports comma decimals', () => {
    expect(minor('1.234,56', 'EUR', { decimalSeparator: ',' })).toBe(123456);
    expect(minor('12,5', 'EUR', { decimalSeparator: ',' })).toBe(1250);
  });

  it('accepts Eastern Arabic and Persian digits with Arabic separators', () => {
    expect(minor('١٢٣\u066B٥٠')).toBe(12350);
    expect(minor('١\u066C٠٠٠')).toBe(100000);
    expect(minor('۱۲')).toBe(1200);
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'invalid'],
    ['12..5', 'invalid'],
    ['1.2.3', 'invalid'],
    ['.', 'invalid'],
    ['-', 'invalid'],
    ['1e5', 'invalid'],
    ['12+8', 'invalid'],
    ['-5', 'negative'],
    ['\u22125', 'negative'],
    ['1.001', 'too_many_decimals'],
  ])('rejects %p as %s', (s, error) => {
    expect(p(s)).toEqual({ ok: false, error });
  });

  it('enforces the 15-digit cap (J2)', () => {
    expect(minor('9999999999999.99')).toBe(999_999_999_999_999);
    expect(p('10000000000000.00')).toEqual({ ok: false, error: 'too_large' });
    expect(p('99999999999999999')).toEqual({ ok: false, error: 'too_large' });
    // leading zeros don't count towards the cap
    expect(minor('0000000000000001.00')).toBe(100);
  });

  it('allows negatives when asked', () => {
    expect(minor('-5', 'USD', { allowNegative: true })).toBe(-500);
    expect(minor('-0', 'USD')).toBe(0);
  });

  it('parsePositiveAmount rejects zero (J2)', () => {
    expect(parsePositiveAmount('0', 'USD')).toEqual({ ok: false, error: 'zero' });
    expect(parsePositiveAmount('0.00', 'USD')).toEqual({ ok: false, error: 'zero' });
    expect(parsePositiveAmount('-1', 'USD')).toEqual({ ok: false, error: 'negative' });
    expect(parsePositiveAmount('', 'USD')).toEqual({ ok: false, error: 'empty' });
    expect(parsePositiveAmount('3', 'USD')).toEqual({ ok: true, value: money(300, 'USD') });
  });
});

describe('toDecimalString', () => {
  it.each([
    [money(123456, 'USD'), '1234.56'],
    [money(5, 'USD'), '0.05'],
    [money(-5, 'USD'), '-0.05'],
    [money(0, 'USD'), '0.00'],
    [money(1500, 'JPY'), '1500'],
    [money(1, 'KWD'), '0.001'],
  ])('%j → %s', (m, s) => {
    expect(toDecimalString(m)).toBe(s);
  });

  it('round-trips with parseAmount', () => {
    for (const n of [0, 1, 99, 100, 123456789, 999_999_999_999_999]) {
      for (const c of ['USD', 'JPY', 'KWD', 'CLF'] as const) {
        const m = money(n, c);
        expect(parseAmount(toDecimalString(m), c)).toEqual({ ok: true, value: m });
      }
    }
  });
});
