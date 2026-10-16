import { normalizeDigits } from '../money/money';

/**
 * Free-text search over note, payee and amount (spec §5.4). If the query also
 * reads as a number, the matching minor-unit amounts for every exponent are
 * returned, so "12.5" finds 12.50 USD, 12.500 KWD and (not) 12 JPY.
 */
export type SearchTerms = Readonly<{ text: string | null; amountsMinor: number[] }>;

export function parseSearch(query: string, decimalSeparator: '.' | ',' = '.'): SearchTerms {
  const text = query.trim();
  if (text === '') return { text: null, amountsMinor: [] };
  const numeric = normalizeDigits(text).replace(decimalSeparator === '.' ? /,/g : /\./g, '');
  const m = (decimalSeparator === '.' ? /^(\d+)(?:\.(\d+))?$/ : /^(\d+)(?:,(\d+))?$/).exec(numeric);
  const amounts = new Set<number>();
  if (m) {
    const whole = m[1] as string;
    const frac = (m[2] ?? '').replace(/0+$/, '');
    for (const exp of [0, 2, 3, 4]) {
      if (frac.length > exp) continue;
      const n = Number(whole + frac.padEnd(exp, '0'));
      if (Number.isSafeInteger(n)) amounts.add(n);
    }
  }
  return { text, amountsMinor: [...amounts] };
}

/** Escape LIKE wildcards so a user typing "%" or "_" matches them literally. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
