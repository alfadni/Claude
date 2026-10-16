import { isCurrencyCode, type CurrencyCode } from '../money/currency';
import { MAX_INPUT_MINOR } from '../money/money';
import { isLocalDate, type LocalDate } from '../time/local-date';
import { validateName, type NameError } from './categories';

export const ACCOUNT_TYPES = ['cash', 'bank', 'mobile_wallet', 'card', 'savings', 'other'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const MAX_ACCOUNT_NAME = 40;

export type AccountInput = Readonly<{
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /** May be negative (e.g. a card already carrying debt). */
  openingBalanceMinor: number;
  openedOn: LocalDate | null;
  includeInTotals: boolean;
  icon?: string | null;
  color?: string | null;
}>;

export type AccountError =
  | NameError
  | 'type_invalid'
  | 'currency_invalid'
  | 'opening_balance_invalid'
  | 'opened_on_invalid'
  | 'currency_locked';

export function validateAccount(input: AccountInput): AccountError[] {
  const errors: AccountError[] = [];
  const nameError = validateName(input.name, MAX_ACCOUNT_NAME);
  if (nameError) errors.push(nameError);
  if (!(ACCOUNT_TYPES as readonly string[]).includes(input.type)) errors.push('type_invalid');
  if (!isCurrencyCode(input.currency)) errors.push('currency_invalid');
  if (
    !Number.isSafeInteger(input.openingBalanceMinor) ||
    Math.abs(input.openingBalanceMinor) > MAX_INPUT_MINOR
  ) {
    errors.push('opening_balance_invalid');
  }
  if (input.openedOn !== null && !isLocalDate(input.openedOn)) errors.push('opened_on_invalid');
  return errors;
}

export const ACCOUNT_ICONS: Record<AccountType, string> = {
  cash: '💵',
  bank: '🏦',
  mobile_wallet: '📱',
  card: '💳',
  savings: '🐖',
  other: '👛',
};
