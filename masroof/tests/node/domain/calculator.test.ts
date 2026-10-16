import { evaluateAmount, isExpression, money, type CurrencyCode } from '@/domain';

const ev = (s: string, c: CurrencyCode = 'USD', sep: '.' | ',' = '.') =>
  evaluateAmount(s, c, { decimalSeparator: sep });

describe('keypad calculator (spec 5.3, J2)', () => {
  it.each([
    ['12+8.5', 2050],
    ['12', 1200],
    ['12.5', 1250],
    ['10-2.25', 775],
    ['3*4', 1200],
    ['3×4', 1200],
    ['10÷4', 250],
    ['2+3*4', 1400], // precedence
    ['2*3+4*5', 2600],
    ['100/3', 3333], // 33.333… → 33.33 (half-even)
    ['0.125*1', 12], // 0.125 → 0.12 (half-even, 2 is even)
    ['0.135*1', 14], // 0.135 → 0.14 (half-even, 3 is odd)
    ['1.1+2.2', 330], // no float error
    ['١٢+٨', 2000], // Eastern Arabic digits
    [' 12 + 8 ', 2000],
    ['-5+10', 500],
    ['12\u22122', 1000], // Unicode minus
  ])('%p = %i minor', (expr, minor) => {
    expect(ev(expr)).toEqual({ ok: true, value: money(minor, 'USD') });
  });

  it('honours comma decimals', () => {
    expect(ev('12,5+1,25', 'EUR', ',')).toEqual({ ok: true, value: money(1375, 'EUR') });
  });

  it('rounds results to the currency exponent', () => {
    expect(ev('10/3', 'JPY')).toEqual({ ok: true, value: money(3, 'JPY') });
    expect(ev('10/3', 'KWD')).toEqual({ ok: true, value: money(3333, 'KWD') });
  });

  it.each([
    ['12++', 'invalid'],
    ['12+', 'invalid'],
    ['+12', 'invalid'],
    ['12..5', 'invalid'],
    ['1.2.3', 'invalid'],
    ['12a', 'invalid'],
    ['.', 'invalid'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['5/0', 'division_by_zero'],
    ['5/(2-2)', 'invalid'], // no parentheses on the keypad
    ['5-10', 'negative'],
    ['-5', 'negative'],
    ['5-5', 'zero'],
    ['0', 'zero'],
    ['0.001*1', 'zero'], // rounds to 0.00
    ['12.345', 'too_many_decimals'], // a typed amount is never silently rounded
    ['9999999999999.99+1', 'too_large'],
    ['99999999999999999999*99999999', 'too_large'],
  ])('%p → %s', (expr, error) => {
    expect(ev(expr)).toEqual({ ok: false, error });
  });

  it('rejects operands with absurd precision', () => {
    expect(ev('1.1234567890123+1')).toEqual({ ok: false, error: 'invalid' });
  });

  it('detects expressions', () => {
    expect(isExpression('12+8')).toBe(true);
    expect(isExpression('12')).toBe(false);
    expect(isExpression('-12')).toBe(false);
  });
});
