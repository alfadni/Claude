/**
 * ISO 4217 currency codes and their minor-unit exponents.
 *
 * The exponent decides how many minor units make one major unit
 * (USD 2 → cents, JPY 0, KWD/BHD 3). It is fixed per currency and must
 * never be inferred from user input or from Intl (CLDR differs from ISO
 * for some codes, e.g. IQD).
 *
 * Withdrawn codes still in circulation in users' history (ANG, BGN) are kept
 * so old data stays valid.
 */

// prettier-ignore
const ZERO_DECIMAL = [
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
] as const;

// prettier-ignore
const THREE_DECIMAL = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'] as const;

// prettier-ignore
const FOUR_DECIMAL = ['CLF', 'UYW'] as const;

// prettier-ignore
const TWO_DECIMAL = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN',
  'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CNY', 'COP', 'CRC', 'CUP',
  'CVE', 'CZK', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD',
  'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GTQ', 'GYD', 'HKD', 'HNL',
  'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IRR', 'JMD', 'KES', 'KGS', 'KHR',
  'KPW', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'MAD', 'MDL',
  'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN',
  'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'PAB', 'PEN',
  'PGK', 'PHP', 'PKR', 'PLN', 'QAR', 'RON', 'RSD', 'RUB', 'SAR', 'SBD',
  'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN',
  'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TOP', 'TRY', 'TTD', 'TWD',
  'TZS', 'UAH', 'USD', 'UYU', 'UZS', 'VED', 'VES', 'WST', 'XCD', 'XCG',
  'YER', 'ZAR', 'ZMW', 'ZWG',
] as const;

export type CurrencyCode =
  | (typeof ZERO_DECIMAL)[number]
  | (typeof TWO_DECIMAL)[number]
  | (typeof THREE_DECIMAL)[number]
  | (typeof FOUR_DECIMAL)[number];

export type Exponent = 0 | 2 | 3 | 4;

const EXPONENTS: ReadonlyMap<string, Exponent> = new Map<string, Exponent>([
  ...ZERO_DECIMAL.map((c) => [c, 0] as const),
  ...TWO_DECIMAL.map((c) => [c, 2] as const),
  ...THREE_DECIMAL.map((c) => [c, 3] as const),
  ...FOUR_DECIMAL.map((c) => [c, 4] as const),
]);

export const ALL_CURRENCIES: readonly CurrencyCode[] = [
  ...EXPONENTS.keys(),
].sort() as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return EXPONENTS.has(value);
}

export function exponentOf(currency: CurrencyCode): Exponent {
  const e = EXPONENTS.get(currency);
  // Unreachable for a correctly typed CurrencyCode; guards against casts.
  if (e === undefined) throw new RangeError(`Unknown currency ${currency}`);
  return e;
}
