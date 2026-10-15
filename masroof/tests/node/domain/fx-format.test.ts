import {
  convert,
  deriveRate,
  divRoundHalfEven,
  formatMoney,
  InvariantError,
  money,
  NUMBER_FORMATS,
  parseRate,
  toArabicIndicDigits,
  type DecimalRate,
} from '@/domain';

const rate = (s: string): DecimalRate => {
  const r = parseRate(s);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('parseRate', () => {
  it('normalises valid rates', () => {
    expect(rate('3.6725')).toBe('3.6725');
    expect(rate('600')).toBe('600');
    expect(rate('0600.500')).toBe('600.5');
    expect(rate('0.00166')).toBe('0.00166');
    expect(rate(' 1.0 ')).toBe('1');
  });

  it.each([
    ['', 'invalid'],
    ['abc', 'invalid'],
    ['-1', 'invalid'],
    ['1e3', 'invalid'],
    ['1.2.3', 'invalid'],
    ['1.1234567890123', 'invalid'], // > 12 fractional digits
    ['0', 'zero'],
    ['0.000', 'zero'],
  ])('rejects %p as %s', (s, error) => {
    expect(parseRate(s)).toEqual({ ok: false, error });
  });
});

describe('divRoundHalfEven', () => {
  it.each([
    [5n, 2n, 2n], // 2.5 → 2
    [7n, 2n, 4n], // 3.5 → 4
    [-5n, 2n, -2n],
    [-7n, 2n, -4n],
    [10n, 3n, 3n],
    [11n, 3n, 4n],
    [5n, -2n, -2n],
  ])('%s / %s = %s', (n, d, q) => {
    expect(divRoundHalfEven(n, d)).toBe(q);
  });

  it('refuses division by zero', () => {
    expect(() => divRoundHalfEven(1n, 0n)).toThrow(InvariantError);
  });
});

describe('convert', () => {
  it('USD → SDG', () => {
    expect(convert(money(10000, 'USD'), rate('600.5'), 'SDG')).toEqual(money(6005000, 'SDG'));
  });

  it('crosses exponents: USD(2) → JPY(0) and → KWD(3)', () => {
    expect(convert(money(100, 'USD'), rate('149.5'), 'JPY')).toEqual(money(150, 'JPY')); // 149.5 → 150 (half-even, odd)
    expect(convert(money(100, 'USD'), rate('148.5'), 'JPY')).toEqual(money(148, 'JPY')); // 148.5 → 148
    expect(convert(money(100, 'USD'), rate('0.3071'), 'KWD')).toEqual(money(307, 'KWD'));
    expect(convert(money(1000, 'JPY'), rate('0.0067'), 'USD')).toEqual(money(670, 'USD'));
  });

  it('keeps sign for negative amounts', () => {
    expect(convert(money(-100, 'USD'), rate('2'), 'EUR')).toEqual(money(-200, 'EUR'));
  });

  it('throws when the result would be unsafe', () => {
    expect(() => convert(money(Number.MAX_SAFE_INTEGER, 'USD'), rate('1000'), 'EUR')).toThrow(
      InvariantError,
    );
  });
});

describe('deriveRate (J4 cross-currency transfer)', () => {
  it('derives the implied rate from both legs', () => {
    expect(deriveRate(money(10000, 'USD'), money(6005000, 'SDG'))).toBe('600.5');
    expect(deriveRate(money(100, 'USD'), money(150, 'JPY'))).toBe('150');
    expect(deriveRate(money(300, 'USD'), money(100, 'USD'))).toBe('0.333333333333');
  });

  it('round-trips via convert to the cent', () => {
    const from = money(12345, 'USD');
    const to = money(4567, 'KWD');
    expect(convert(from, deriveRate(from, to), 'KWD')).toEqual(to);
  });

  it('rejects zero legs and underflow', () => {
    expect(() => deriveRate(money(0, 'USD'), money(1, 'EUR'))).toThrow(InvariantError);
    expect(() => deriveRate(money(999_999_999_999_999, 'JPY'), money(1, 'KWD'), 2)).toThrow(
      InvariantError,
    );
  });
});

describe('formatMoney', () => {
  const NBSP = '\u00A0';
  it('formats with defaults', () => {
    expect(formatMoney(money(123456, 'USD'))).toBe(`1,234.56${NBSP}USD`);
    expect(formatMoney(money(5, 'USD'))).toBe(`0.05${NBSP}USD`);
    expect(formatMoney(money(1234567, 'JPY'))).toBe(`1,234,567${NBSP}JPY`);
    expect(formatMoney(money(1, 'KWD'))).toBe(`0.001${NBSP}KWD`);
    expect(formatMoney(money(100, 'USD'), { currencyDisplay: 'none' })).toBe('1.00');
  });

  it('applies number format settings', () => {
    const m = money(123456789, 'EUR');
    expect(formatMoney(m, { format: NUMBER_FORMATS.eu, currencyDisplay: 'none' })).toBe(
      '1.234.567,89',
    );
    expect(formatMoney(m, { format: NUMBER_FORMATS.space, currencyDisplay: 'none' })).toBe(
      '1\u00A0234\u00A0567,89',
    );
    expect(formatMoney(m, { format: NUMBER_FORMATS.plain, currencyDisplay: 'none' })).toBe(
      '1234567.89',
    );
  });

  it('shows explicit signs so colour is never the only signal', () => {
    expect(formatMoney(money(-500, 'USD'), { currencyDisplay: 'none' })).toBe('\u22125.00');
    expect(formatMoney(money(500, 'USD'), { signDisplay: 'always', currencyDisplay: 'none' })).toBe(
      '+5.00',
    );
    expect(formatMoney(money(0, 'USD'), { signDisplay: 'always', currencyDisplay: 'none' })).toBe(
      '0.00',
    );
  });

  it('renders Eastern Arabic numerals with Arabic separators', () => {
    expect(formatMoney(money(123456, 'SDG'), { numerals: 'arab', currencyDisplay: 'none' })).toBe(
      '١\u066C٢٣٤\u066B٥٦',
    );
    expect(
      formatMoney(money(123456, 'SDG'), {
        numerals: 'arab',
        format: NUMBER_FORMATS.plain,
        currencyDisplay: 'none',
      }),
    ).toBe('١٢٣٤\u066B٥٦');
    expect(toArabicIndicDigits('2026')).toBe('٢٠٢٦');
  });
});
