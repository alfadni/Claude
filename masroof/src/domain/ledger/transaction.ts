import type { CurrencyCode } from '../money/currency';
import { convert, deriveRate, RATE_ONE, type DecimalRate } from '../money/fx';
import { allocate, MAX_INPUT_MINOR, money, type Money } from '../money/money';
import type { LocalDate } from '../time/local-date';

export type TransactionType = 'expense' | 'income' | 'transfer';
export type CategoryKind = 'expense' | 'income';

export const MAX_NOTE_LENGTH = 1000;
export const MAX_TAGS = 10;
export const MAX_SPLITS = 20;
export const MAX_ATTACHMENTS = 5;

export type SplitInput = Readonly<{
  categoryId: string;
  amountMinor: number;
  note?: string | null;
}>;

/** What the user submits from quick add / edit. Amounts in the account's currency. */
export type TransactionInput = Readonly<{
  type: TransactionType;
  accountId: string;
  toAccountId?: string | null;
  amountMinor: number;
  /** Transfers only: amount arriving in the destination account's currency. */
  toAmountMinor?: number | null;
  occurredAt: number;
  occurredTz: string;
  occurredOn: LocalDate;
  note?: string | null;
  payeeName?: string | null;
  tagNames?: readonly string[];
  /** Non-transfers: at least one; a "simple" transaction is one split. */
  splits: readonly SplitInput[];
  /** Rate from the transaction currency to the base currency, when they differ. */
  fxRateToBase?: DecimalRate | null;
}>;

export type AccountFacts = Readonly<{
  id: string;
  currency: CurrencyCode;
  isArchived: boolean;
  isDeleted: boolean;
  openedOn: LocalDate | null;
  /** Current balance in the account currency (for transfer warnings). */
  balanceMinor: number;
}>;

export type CategoryFacts = Readonly<{
  id: string;
  kind: CategoryKind;
  isArchived: boolean;
  isDeleted: boolean;
}>;

export type ValidationContext = Readonly<{
  baseCurrency: CurrencyCode;
  today: LocalDate;
  account: (id: string) => AccountFacts | undefined;
  category: (id: string) => CategoryFacts | undefined;
  /** When editing: categories already on the transaction may be archived. */
  existingCategoryIds?: ReadonlySet<string>;
}>;

export type TxError =
  | 'amount_invalid'
  | 'account_missing'
  | 'account_archived'
  | 'to_account_missing'
  | 'to_account_archived'
  | 'same_account'
  | 'to_amount_invalid'
  | 'transfer_has_splits'
  | 'splits_required'
  | 'too_many_splits'
  | 'split_amount_invalid'
  | 'split_sum_mismatch'
  | 'category_missing'
  | 'category_archived'
  | 'category_kind_mismatch'
  | 'fx_rate_required'
  | 'note_too_long'
  | 'too_many_tags';

export type TxWarning = 'scheduled' | 'before_account_opening' | 'insufficient_balance';

export type Validation = Readonly<{ errors: TxError[]; warnings: TxWarning[] }>;

const isAmount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= MAX_INPUT_MINOR;

/**
 * Every rule a transaction must satisfy before it reaches the database.
 * Errors block saving; warnings are shown but allowed (spec J2, J4).
 */
export function validateTransaction(input: TransactionInput, ctx: ValidationContext): Validation {
  const errors = new Set<TxError>();
  const warnings = new Set<TxWarning>();

  if (!isAmount(input.amountMinor)) errors.add('amount_invalid');
  if ((input.note ?? '').length > MAX_NOTE_LENGTH) errors.add('note_too_long');
  if ((input.tagNames ?? []).length > MAX_TAGS) errors.add('too_many_tags');

  const account = ctx.account(input.accountId);
  if (!account || account.isDeleted) errors.add('account_missing');
  else if (account.isArchived) errors.add('account_archived');

  if (input.occurredOn > ctx.today) warnings.add('scheduled');
  if (account?.openedOn && input.occurredOn < account.openedOn) {
    warnings.add('before_account_opening');
  }

  if (input.type === 'transfer') {
    if (input.splits.length > 0) errors.add('transfer_has_splits');
    const to = input.toAccountId ? ctx.account(input.toAccountId) : undefined;
    if (!input.toAccountId || !to || to.isDeleted) errors.add('to_account_missing');
    else if (to.isArchived) errors.add('to_account_archived');
    if (input.toAccountId && input.toAccountId === input.accountId) errors.add('same_account');
    if (to && account && to.currency !== account.currency && !isAmount(input.toAmountMinor)) {
      errors.add('to_amount_invalid');
    }
    if (account && isAmount(input.amountMinor) && account.balanceMinor < input.amountMinor) {
      warnings.add('insufficient_balance');
    }
  } else {
    if (input.splits.length === 0) errors.add('splits_required');
    if (input.splits.length > MAX_SPLITS) errors.add('too_many_splits');
    let total = 0;
    for (const s of input.splits) {
      if (!isAmount(s.amountMinor)) errors.add('split_amount_invalid');
      else total += s.amountMinor;
      const c = ctx.category(s.categoryId);
      if (!c || c.isDeleted) errors.add('category_missing');
      else {
        if (c.kind !== input.type) errors.add('category_kind_mismatch');
        if (c.isArchived && !ctx.existingCategoryIds?.has(c.id)) errors.add('category_archived');
      }
    }
    if (input.splits.length > 0 && total !== input.amountMinor) errors.add('split_sum_mismatch');
  }

  if (account && account.currency !== ctx.baseCurrency && !input.fxRateToBase) {
    // A transfer from a foreign account into a base-currency account carries
    // its own rate (the two legs), so it needs no separate rate.
    const to = input.toAccountId ? ctx.account(input.toAccountId) : undefined;
    const transferIntoBase = input.type === 'transfer' && to?.currency === ctx.baseCurrency;
    if (!transferIntoBase) errors.add('fx_rate_required');
  }

  return { errors: [...errors], warnings: [...warnings] };
}

// ---------------------------------------------------------------------------
// Splits (J3)
// ---------------------------------------------------------------------------

/** Total minus the splits entered so far: the live "remaining" indicator. */
export function splitRemaining(total: Money, splitAmounts: readonly number[]): Money {
  const used = splitAmounts.reduce((a, b) => a + (Number.isSafeInteger(b) ? b : 0), 0);
  return money(total.amountMinor - used, total.currency);
}

/**
 * Leaving split mode collapses to one category. The largest split's
 * category wins (ties: the first), so the transaction keeps its dominant meaning.
 */
export function collapseSplits(splits: readonly SplitInput[], totalMinor: number): SplitInput[] {
  if (splits.length === 0) return [];
  const winner = splits.reduce((best, s) => (s.amountMinor > best.amountMinor ? s : best));
  return [{ categoryId: winner.categoryId, amountMinor: totalMinor, note: null }];
}

// ---------------------------------------------------------------------------
// Base-currency amounts (frozen at entry time, spec §4)
// ---------------------------------------------------------------------------

export type BaseAmounts = Readonly<{
  fxRateToBase: DecimalRate;
  baseAmountMinor: number;
  /** Base amount per split, allocated so they sum exactly to baseAmountMinor. */
  splitBaseMinor: number[];
}>;

export function computeBaseAmounts(params: {
  amount: Money;
  baseCurrency: CurrencyCode;
  rate?: DecimalRate | null;
  /** Transfers into the base currency: use the received leg directly. */
  baseLegMinor?: number | null;
  splitAmounts: readonly number[];
}): BaseAmounts {
  const { amount, baseCurrency } = params;
  let fxRateToBase: DecimalRate;
  let base: Money;
  if (amount.currency === baseCurrency) {
    fxRateToBase = RATE_ONE;
    base = amount;
  } else if (params.baseLegMinor != null) {
    base = money(params.baseLegMinor, baseCurrency);
    fxRateToBase = params.rate ?? deriveRate(amount, base);
  } else {
    if (!params.rate) throw new Error('computeBaseAmounts: rate required for foreign currency');
    fxRateToBase = params.rate;
    base = convert(amount, params.rate, baseCurrency);
  }
  const splitBaseMinor =
    params.splitAmounts.length === 0
      ? []
      : allocate(base, [...params.splitAmounts]).map((m) => m.amountMinor);
  return { fxRateToBase, baseAmountMinor: base.amountMinor, splitBaseMinor };
}

/** "Scheduled" = dated after today; excluded from "spent so far" (J2). */
export function isScheduled(occurredOn: LocalDate, today: LocalDate): boolean {
  return occurredOn > today;
}

// ---------------------------------------------------------------------------
// Names (payees, tags)
// ---------------------------------------------------------------------------

/** Case/space-insensitive key so "Al Amin " and "al  amin" are one payee. */
export function normalizeName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function cleanTagNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/^#/, '').replace(/\s+/g, ' ');
    const key = normalizeName(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** Edits to a recurring-generated transaction must say how far they reach (J7). */
export type EditScope = 'this_only' | 'this_and_future';
