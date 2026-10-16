import {
  collapseSplits,
  deriveRate,
  evaluateAmount,
  isLocalDate,
  money,
  parseAmount,
  parseRate,
  splitRemaining,
  startOfDayInZone,
  toDecimalString,
  type CalcError,
  type CurrencyCode,
  type DecimalRate,
  type LocalDate,
  type Money,
  type TransactionInput,
  type TransactionType,
} from '@/domain';
import type { KeypadKey } from '@/ui';

/**
 * Quick-add form as a pure state machine (no React), so every J2/J3/J4 rule is
 * unit-testable. Amount input is a calculator expression in canonical ASCII
 * (digits, the user's decimal separator, + - * /); the screen renders glyphs.
 */
export type SplitRow = { key: number; categoryId: string | null; text: string };

export type FormState = {
  editId: string | null;
  type: TransactionType;
  expression: string;
  /** Last amount that evaluated cleanly; kept while the expression is invalid (J2). */
  lastValidMinor: number | null;
  accountId: string | null;
  toAccountId: string | null;
  toAmountText: string;
  categoryId: string | null;
  splitMode: boolean;
  splits: SplitRow[];
  nextSplitKey: number;
  occurredOn: LocalDate;
  /** Edit mode: the original instant is kept unless the date changes. */
  original: { occurredOn: LocalDate; occurredAt: number; occurredTz: string } | null;
  note: string;
  payee: string;
  tags: string;
  rateText: string;
  pendingPhotos: string[];
};

export const MAX_EXPRESSION = 40;

export function initialState(params: {
  today: LocalDate;
  accountId: string | null;
  type?: TransactionType;
  occurredOn?: LocalDate | null;
}): FormState {
  return {
    editId: null,
    type: params.type ?? 'expense',
    expression: '',
    lastValidMinor: null,
    accountId: params.accountId,
    toAccountId: null,
    toAmountText: '',
    categoryId: null,
    splitMode: false,
    splits: [],
    nextSplitKey: 1,
    occurredOn: params.occurredOn ?? params.today,
    original: null,
    note: '',
    payee: '',
    tags: '',
    rateText: '',
    pendingPhotos: [],
  };
}

export type Action =
  | { kind: 'key'; key: KeypadKey; decimalSeparator: '.' | ','; currency: CurrencyCode }
  | { kind: 'type'; type: TransactionType }
  | { kind: 'account'; id: string }
  | { kind: 'toAccount'; id: string }
  | { kind: 'toAmount'; text: string }
  | { kind: 'category'; id: string }
  | { kind: 'date'; date: LocalDate }
  | { kind: 'field'; field: 'note' | 'payee' | 'tags' | 'rateText'; value: string }
  | { kind: 'splitOn'; currency: CurrencyCode }
  /** Leave split mode: collapse to the largest split's category (J3). */
  | { kind: 'splitOff'; currency: CurrencyCode; decimalSeparator: '.' | ',' }
  | { kind: 'splitAdd' }
  | { kind: 'splitRemove'; key: number }
  | { kind: 'splitCategory'; key: number; id: string }
  | { kind: 'splitAmount'; key: number; text: string }
  | { kind: 'photoAdd'; uri: string }
  | { kind: 'photoRemove'; uri: string }
  | { kind: 'replace'; state: FormState };

export function applyKey(expression: string, key: KeypadKey, decimalSeparator: '.' | ','): string {
  if (key === 'clear') return '';
  if (key === 'back') return expression.slice(0, -1);
  if (expression.length >= MAX_EXPRESSION) return expression;
  if (key === 'decimal') return expression + decimalSeparator;
  return expression + key; // digits and operators append as typed; "12++" is reported, not hidden
}

function evaluate(expression: string, currency: CurrencyCode, sep: '.' | ',') {
  return expression.trim() === ''
    ? null
    : evaluateAmount(expression, currency, { decimalSeparator: sep });
}

export function reducer(state: FormState, action: Action): FormState {
  switch (action.kind) {
    case 'key': {
      const expression = applyKey(state.expression, action.key, action.decimalSeparator);
      const r = evaluate(expression, action.currency, action.decimalSeparator);
      return {
        ...state,
        expression,
        lastValidMinor: r === null ? null : r.ok ? r.value.amountMinor : state.lastValidMinor,
      };
    }
    case 'type':
      if (action.type === state.type) return state;
      // Categories are kind-specific: switching type clears them.
      return { ...state, type: action.type, categoryId: null, splitMode: false, splits: [] };
    case 'account':
      return {
        ...state,
        accountId: action.id,
        toAccountId: state.toAccountId === action.id ? null : state.toAccountId,
        rateText: state.accountId === action.id ? state.rateText : '',
      };
    case 'toAccount':
      return { ...state, toAccountId: action.id, toAmountText: '' };
    case 'toAmount':
      return { ...state, toAmountText: action.text };
    case 'category':
      return { ...state, categoryId: action.id };
    case 'date':
      return { ...state, occurredOn: action.date };
    case 'field':
      return { ...state, [action.field]: action.value };
    case 'splitOn': {
      const total = state.lastValidMinor;
      const first: SplitRow = {
        key: state.nextSplitKey,
        categoryId: state.categoryId,
        text: total ? toDecimalString(money(total, action.currency)) : '',
      };
      const second: SplitRow = { key: state.nextSplitKey + 1, categoryId: null, text: '' };
      return {
        ...state,
        splitMode: true,
        splits: [first, second],
        nextSplitKey: state.nextSplitKey + 2,
      };
    }
    case 'splitOff': {
      const parsed = state.splits
        .map((s) => ({
          categoryId: s.categoryId,
          amountMinor: parseRow(s.text, action.currency, action.decimalSeparator) ?? 0,
        }))
        .filter((s): s is { categoryId: string; amountMinor: number } => s.categoryId !== null);
      const winner = collapseSplits(parsed, state.lastValidMinor ?? 0)[0];
      return {
        ...state,
        splitMode: false,
        splits: [],
        categoryId: winner?.categoryId ?? state.categoryId,
      };
    }
    case 'splitAdd':
      return {
        ...state,
        splits: [...state.splits, { key: state.nextSplitKey, categoryId: null, text: '' }],
        nextSplitKey: state.nextSplitKey + 1,
      };
    case 'splitRemove':
      return { ...state, splits: state.splits.filter((s) => s.key !== action.key) };
    case 'splitCategory':
      return {
        ...state,
        splits: state.splits.map((s) =>
          s.key === action.key ? { ...s, categoryId: action.id } : s,
        ),
      };
    case 'splitAmount':
      return {
        ...state,
        splits: state.splits.map((s) => (s.key === action.key ? { ...s, text: action.text } : s)),
      };
    case 'photoAdd':
      return state.pendingPhotos.includes(action.uri)
        ? state
        : { ...state, pendingPhotos: [...state.pendingPhotos, action.uri] };
    case 'photoRemove':
      return { ...state, pendingPhotos: state.pendingPhotos.filter((u) => u !== action.uri) };
    case 'replace':
      return action.state;
  }
}

function parseRow(text: string, currency: CurrencyCode, sep: '.' | ','): number | null {
  const r = parseAmount(text, currency, { decimalSeparator: sep });
  return r.ok && r.value.amountMinor > 0 ? r.value.amountMinor : null;
}

// ---------------------------------------------------------------------------
// Derivation: what the screen shows and what gets submitted
// ---------------------------------------------------------------------------

export type Env = Readonly<{
  currency: CurrencyCode | null;
  toCurrency: CurrencyCode | null;
  baseCurrency: CurrencyCode;
  decimalSeparator: '.' | ',';
  today: LocalDate;
  timeZone: string;
  now: number;
}>;

export type FormIssue =
  | CalcError
  | 'account_missing'
  | 'to_account_missing'
  | 'to_amount_invalid'
  | 'splits_required'
  | 'split_amount_invalid'
  | 'split_sum_mismatch'
  | 'fx_rate_required'
  | 'rate_invalid';

export type Derived = Readonly<{
  amount: Money | null;
  /** Shown under the amount when the expression is non-empty but invalid. */
  amountError: CalcError | null;
  /** Live "remaining" for split mode (J3). */
  remaining: Money | null;
  needsRate: boolean;
  rate: DecimalRate | null;
  toAmount: Money | null;
  impliedRate: DecimalRate | null;
  issues: FormIssue[];
  input: TransactionInput | null;
}>;

export function derive(state: FormState, env: Env): Derived {
  const issues: FormIssue[] = [];
  const currency = env.currency;
  const r = currency ? evaluate(state.expression, currency, env.decimalSeparator) : null;
  const amount = r?.ok ? r.value : null;
  const amountError = r && !r.ok ? r.error : null;
  if (!currency) issues.push('account_missing');
  if (r === null) issues.push('empty');
  else if (!r.ok) issues.push(r.error);

  // Transfers
  let toAmount: Money | null = null;
  let impliedRate: DecimalRate | null = null;
  const isTransfer = state.type === 'transfer';
  const crossCurrency = isTransfer && !!env.toCurrency && !!currency && env.toCurrency !== currency;
  if (isTransfer) {
    if (!state.toAccountId || !env.toCurrency) issues.push('to_account_missing');
    if (crossCurrency && env.toCurrency) {
      const t = parseAmount(state.toAmountText, env.toCurrency, {
        decimalSeparator: env.decimalSeparator,
      });
      if (t.ok && t.value.amountMinor > 0) {
        toAmount = t.value;
        if (amount) impliedRate = deriveRate(amount, toAmount);
      } else issues.push('to_amount_invalid');
    }
  }

  // Exchange rate to base (non-transfer from a foreign account, or a transfer
  // between two non-base currencies).
  const transferIntoBase = isTransfer && env.toCurrency === env.baseCurrency;
  const needsRate = !!currency && currency !== env.baseCurrency && !transferIntoBase;
  let rate: DecimalRate | null = null;
  if (needsRate) {
    if (state.rateText.trim() === '') issues.push('fx_rate_required');
    else {
      const pr = parseRate(state.rateText.replace(',', '.'));
      if (pr.ok) rate = pr.value;
      else issues.push('rate_invalid');
    }
  }

  // Categories / splits
  let remaining: Money | null = null;
  let splits: { categoryId: string; amountMinor: number }[] = [];
  if (!isTransfer) {
    if (state.splitMode) {
      const rows = state.splits.map((s) => ({
        categoryId: s.categoryId,
        amountMinor: currency ? parseRow(s.text, currency, env.decimalSeparator) : null,
      }));
      if (amount)
        remaining = splitRemaining(
          amount,
          rows.map((x) => x.amountMinor ?? 0),
        );
      if (rows.some((x) => x.categoryId === null) || rows.length === 0)
        issues.push('splits_required');
      if (rows.some((x) => x.amountMinor === null)) issues.push('split_amount_invalid');
      if (remaining && remaining.amountMinor !== 0) issues.push('split_sum_mismatch');
      splits = rows
        .filter(
          (x): x is { categoryId: string; amountMinor: number } =>
            !!x.categoryId && x.amountMinor !== null,
        )
        .map((x) => ({ categoryId: x.categoryId, amountMinor: x.amountMinor }));
    } else if (!state.categoryId) {
      issues.push('splits_required');
    } else if (amount) {
      splits = [{ categoryId: state.categoryId, amountMinor: amount.amountMinor }];
    }
  }

  let input: TransactionInput | null = null;
  if (issues.length === 0 && amount && state.accountId && isLocalDate(state.occurredOn)) {
    const sameDayAsOriginal = state.original && state.original.occurredOn === state.occurredOn;
    const occurredAt = sameDayAsOriginal
      ? (state.original as { occurredAt: number }).occurredAt
      : state.occurredOn === env.today
        ? env.now
        : startOfDayInZone(state.occurredOn, env.timeZone) + 12 * 3_600_000; // noon: DST-safe
    input = {
      type: state.type,
      accountId: state.accountId,
      toAccountId: isTransfer ? state.toAccountId : null,
      amountMinor: amount.amountMinor,
      toAmountMinor: isTransfer ? (toAmount?.amountMinor ?? null) : null,
      occurredAt,
      occurredTz: sameDayAsOriginal
        ? (state.original as { occurredTz: string }).occurredTz
        : env.timeZone,
      occurredOn: state.occurredOn,
      note: state.note.trim() || null,
      payeeName: state.payee.trim() || null,
      tagNames: state.tags
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      splits,
      fxRateToBase: rate,
    };
  }

  return { amount, amountError, remaining, needsRate, rate, toAmount, impliedRate, issues, input };
}

/** Display form of the canonical expression (× ÷ \u2212 and optional Arabic digits). */
export function displayExpression(expression: string, arabicDigits: boolean): string {
  let s = expression.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '\u2212');
  if (arabicDigits)
    s = s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d))).replace(/[.,]/g, '\u066B');
  return s;
}

/** Drafts come back from storage: accept only a structurally valid FormState. */
export function reviveDraft(raw: unknown): FormState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<FormState>;
  const okType = s.type === 'expense' || s.type === 'income' || s.type === 'transfer';
  if (
    !okType ||
    typeof s.expression !== 'string' ||
    typeof s.occurredOn !== 'string' ||
    !isLocalDate(s.occurredOn)
  ) {
    return null;
  }
  if (!Array.isArray(s.splits) || !Array.isArray(s.pendingPhotos)) return null;
  if (s.editId) return null; // drafts are for new entries only
  return s as FormState;
}

/** Edit mode: rebuild the form from a stored transaction. */
export function stateFromTransaction(
  d: {
    id: string;
    type: TransactionType;
    accountId: string;
    toAccountId: string | null;
    amountMinor: number;
    currency: string;
    toAmountMinor: number | null;
    toCurrency: string | null;
    occurredOn: string;
    occurredAt: number;
    occurredTz: string;
    note: string | null;
    payeeName: string | null;
    fxRateToBase: string;
    splits: readonly { categoryId: string; amountMinor: number }[];
    tags: readonly { name: string }[];
  },
  today: LocalDate,
  decimalSeparator: '.' | ',',
): FormState {
  const currency = d.currency as CurrencyCode;
  const asText = (minor: number, c: CurrencyCode) =>
    toDecimalString(money(minor, c)).replace('.', decimalSeparator);
  const split = d.splits.length > 1;
  const rows = d.splits.map((s, i) => ({
    key: i + 1,
    categoryId: s.categoryId,
    text: asText(s.amountMinor, currency),
  }));
  const occurredOn = d.occurredOn as LocalDate;
  return {
    ...initialState({ today, accountId: d.accountId, type: d.type }),
    editId: d.id,
    expression: asText(d.amountMinor, currency),
    lastValidMinor: d.amountMinor,
    toAccountId: d.toAccountId,
    toAmountText:
      d.toAmountMinor && d.toCurrency && d.toCurrency !== d.currency
        ? asText(d.toAmountMinor, d.toCurrency as CurrencyCode)
        : '',
    categoryId: d.splits.length === 1 ? (d.splits[0]?.categoryId ?? null) : null,
    splitMode: split,
    splits: split ? rows : [],
    nextSplitKey: rows.length + 1,
    occurredOn,
    original: { occurredOn, occurredAt: d.occurredAt, occurredTz: d.occurredTz },
    note: d.note ?? '',
    payee: d.payeeName ?? '',
    tags: d.tags.map((x) => x.name).join(', '),
    rateText: d.fxRateToBase === '1' ? '' : d.fxRateToBase,
  };
}
