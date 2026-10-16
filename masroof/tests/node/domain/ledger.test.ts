import {
  cleanTagNames,
  collapseSplits,
  computeBaseAmounts,
  invertRate,
  isDraftFresh,
  isScheduled,
  likePattern,
  localDate,
  money,
  normalizeName,
  parseRate,
  parseSearch,
  SEED_CATEGORIES,
  splitRemaining,
  trashCutoff,
  validateAccount,
  validateTransaction,
  type AccountFacts,
  type CategoryFacts,
  type DecimalRate,
  type TransactionInput,
  type ValidationContext,
} from '@/domain';

const d = localDate;
const rate = (s: string) => {
  const r = parseRate(s);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

const accounts: Record<string, AccountFacts> = {
  cash: {
    id: 'cash',
    currency: 'USD',
    isArchived: false,
    isDeleted: false,
    openedOn: d('2026-01-01'),
    balanceMinor: 5000,
  },
  bank: {
    id: 'bank',
    currency: 'USD',
    isArchived: false,
    isDeleted: false,
    openedOn: null,
    balanceMinor: 100000,
  },
  old: {
    id: 'old',
    currency: 'USD',
    isArchived: true,
    isDeleted: false,
    openedOn: null,
    balanceMinor: 0,
  },
  gone: {
    id: 'gone',
    currency: 'USD',
    isArchived: false,
    isDeleted: true,
    openedOn: null,
    balanceMinor: 0,
  },
  sdg: {
    id: 'sdg',
    currency: 'SDG',
    isArchived: false,
    isDeleted: false,
    openedOn: null,
    balanceMinor: 0,
  },
};
const categories: Record<string, CategoryFacts> = {
  food: { id: 'food', kind: 'expense', isArchived: false, isDeleted: false },
  kids: { id: 'kids', kind: 'expense', isArchived: false, isDeleted: false },
  salary: { id: 'salary', kind: 'income', isArchived: false, isDeleted: false },
  archived: { id: 'archived', kind: 'expense', isArchived: true, isDeleted: false },
};
const ctx: ValidationContext = {
  baseCurrency: 'USD',
  today: d('2026-10-16'),
  account: (id) => accounts[id],
  category: (id) => categories[id],
};

const expense = (over: Partial<TransactionInput> = {}): TransactionInput => ({
  type: 'expense',
  accountId: 'cash',
  amountMinor: 1250,
  occurredAt: Date.UTC(2026, 9, 16, 10),
  occurredTz: 'Africa/Khartoum',
  occurredOn: d('2026-10-16'),
  splits: [{ categoryId: 'food', amountMinor: 1250 }],
  ...over,
});

const transfer = (over: Partial<TransactionInput> = {}): TransactionInput =>
  expense({
    type: 'transfer',
    accountId: 'bank',
    toAccountId: 'cash',
    amountMinor: 10000,
    splits: [],
    ...over,
  });

describe('validateTransaction: J2 add expense', () => {
  it('accepts a valid expense with no warnings', () => {
    expect(validateTransaction(expense(), ctx)).toEqual({ errors: [], warnings: [] });
  });

  it.each([0, -1, 1.5, Number.NaN, 1e15])('rejects amount %p', (amountMinor) => {
    const v = validateTransaction(
      expense({ amountMinor, splits: [{ categoryId: 'food', amountMinor }] }),
      ctx,
    );
    expect(v.errors).toContain('amount_invalid');
  });

  it('labels a future date as scheduled but allows it', () => {
    const v = validateTransaction(expense({ occurredOn: d('2026-10-20') }), ctx);
    expect(v).toEqual({ errors: [], warnings: ['scheduled'] });
    expect(isScheduled(d('2026-10-20'), d('2026-10-16'))).toBe(true);
    expect(isScheduled(d('2026-10-16'), d('2026-10-16'))).toBe(false);
  });

  it('warns but allows a date before the account opened', () => {
    const v = validateTransaction(expense({ occurredOn: d('2025-12-31') }), ctx);
    expect(v).toEqual({ errors: [], warnings: ['before_account_opening'] });
  });

  it('rejects missing, deleted or archived accounts', () => {
    expect(validateTransaction(expense({ accountId: 'nope' }), ctx).errors).toContain(
      'account_missing',
    );
    expect(validateTransaction(expense({ accountId: 'gone' }), ctx).errors).toContain(
      'account_missing',
    );
    expect(validateTransaction(expense({ accountId: 'old' }), ctx).errors).toContain(
      'account_archived',
    );
  });

  it('rejects wrong-kind, missing or archived categories', () => {
    const withCat = (categoryId: string) =>
      expense({ splits: [{ categoryId, amountMinor: 1250 }] });
    expect(validateTransaction(withCat('salary'), ctx).errors).toEqual(['category_kind_mismatch']);
    expect(validateTransaction(withCat('nope'), ctx).errors).toEqual(['category_missing']);
    expect(validateTransaction(withCat('archived'), ctx).errors).toEqual(['category_archived']);
  });

  it('allows an archived category that is already on the transaction (editing history)', () => {
    const v = validateTransaction(
      expense({ splits: [{ categoryId: 'archived', amountMinor: 1250 }] }),
      { ...ctx, existingCategoryIds: new Set(['archived']) },
    );
    expect(v.errors).toEqual([]);
  });

  it('requires a category', () => {
    expect(validateTransaction(expense({ splits: [] }), ctx).errors).toEqual(['splits_required']);
  });

  it('limits notes and tags', () => {
    expect(validateTransaction(expense({ note: 'x'.repeat(1001) }), ctx).errors).toEqual([
      'note_too_long',
    ]);
    const tags = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(validateTransaction(expense({ tagNames: tags }), ctx).errors).toEqual(['too_many_tags']);
  });

  it('needs a rate when the account is not in the base currency', () => {
    expect(validateTransaction(expense({ accountId: 'sdg' }), ctx).errors).toEqual([
      'fx_rate_required',
    ]);
    expect(
      validateTransaction(expense({ accountId: 'sdg', fxRateToBase: rate('0.0017') }), ctx).errors,
    ).toEqual([]);
  });
});

describe('validateTransaction: J3 splits', () => {
  it('accepts splits summing to the total ($123 = 80 + 43)', () => {
    const v = validateTransaction(
      expense({
        amountMinor: 12300,
        splits: [
          { categoryId: 'food', amountMinor: 8000 },
          { categoryId: 'kids', amountMinor: 4300 },
        ],
      }),
      ctx,
    );
    expect(v.errors).toEqual([]);
  });

  it('blocks splits that do not sum to the total', () => {
    const v = validateTransaction(
      expense({
        amountMinor: 12300,
        splits: [
          { categoryId: 'food', amountMinor: 8000 },
          { categoryId: 'kids', amountMinor: 4000 },
        ],
      }),
      ctx,
    );
    expect(v.errors).toEqual(['split_sum_mismatch']);
  });

  it('blocks zero or negative split rows', () => {
    const v = validateTransaction(
      expense({
        amountMinor: 100,
        splits: [
          { categoryId: 'food', amountMinor: 100 },
          { categoryId: 'kids', amountMinor: 0 },
        ],
      }),
      ctx,
    );
    expect(v.errors).toContain('split_amount_invalid');
  });

  it('caps the number of splits', () => {
    const splits = Array.from({ length: 21 }, () => ({ categoryId: 'food', amountMinor: 1 }));
    expect(validateTransaction(expense({ amountMinor: 21, splits }), ctx).errors).toEqual([
      'too_many_splits',
    ]);
  });

  it('shows a live remaining amount', () => {
    expect(splitRemaining(money(12300, 'USD'), [8000])).toEqual(money(4300, 'USD'));
    expect(splitRemaining(money(12300, 'USD'), [8000, 4300])).toEqual(money(0, 'USD'));
    expect(splitRemaining(money(12300, 'USD'), [8000, 5000])).toEqual(money(-700, 'USD'));
    expect(splitRemaining(money(100, 'USD'), [Number.NaN])).toEqual(money(100, 'USD'));
  });

  it('collapses to the largest split category when split mode is removed', () => {
    expect(
      collapseSplits(
        [
          { categoryId: 'kids', amountMinor: 4300 },
          { categoryId: 'food', amountMinor: 8000 },
        ],
        12300,
      ),
    ).toEqual([{ categoryId: 'food', amountMinor: 12300, note: null }]);
    expect(
      collapseSplits(
        [
          { categoryId: 'a', amountMinor: 5 },
          { categoryId: 'b', amountMinor: 5 },
        ],
        10,
      )[0]?.categoryId,
    ).toBe('a');
    expect(collapseSplits([], 10)).toEqual([]);
  });
});

describe('validateTransaction: J4 transfers', () => {
  it('accepts a same-currency transfer (no categories needed)', () => {
    expect(validateTransaction(transfer(), ctx)).toEqual({ errors: [], warnings: [] });
  });

  it('blocks same source and destination', () => {
    expect(validateTransaction(transfer({ toAccountId: 'bank' }), ctx).errors).toContain(
      'same_account',
    );
  });

  it('blocks archived or missing accounts', () => {
    expect(validateTransaction(transfer({ accountId: 'old' }), ctx).errors).toContain(
      'account_archived',
    );
    expect(validateTransaction(transfer({ toAccountId: 'old' }), ctx).errors).toContain(
      'to_account_archived',
    );
    expect(validateTransaction(transfer({ toAccountId: null }), ctx).errors).toContain(
      'to_account_missing',
    );
  });

  it('warns on insufficient balance but allows', () => {
    const v = validateTransaction(
      transfer({ accountId: 'cash', toAccountId: 'bank', amountMinor: 999999 }),
      ctx,
    );
    expect(v).toEqual({ errors: [], warnings: ['insufficient_balance'] });
  });

  it('requires the received amount for cross-currency transfers', () => {
    expect(validateTransaction(transfer({ toAccountId: 'sdg' }), ctx).errors).toEqual([
      'to_amount_invalid',
    ]);
    expect(
      validateTransaction(transfer({ toAccountId: 'sdg', toAmountMinor: 6005000 }), ctx).errors,
    ).toEqual([]);
  });

  it('a foreign-currency source sending into the base currency needs no separate rate', () => {
    const v = validateTransaction(
      transfer({ accountId: 'sdg', toAccountId: 'bank', toAmountMinor: 1000 }),
      ctx,
    );
    expect(v.errors).toEqual([]);
  });

  it('rejects categories on a transfer', () => {
    expect(
      validateTransaction(transfer({ splits: [{ categoryId: 'food', amountMinor: 10000 }] }), ctx)
        .errors,
    ).toContain('transfer_has_splits');
  });
});

describe('computeBaseAmounts', () => {
  it('same currency: rate 1', () => {
    expect(
      computeBaseAmounts({
        amount: money(12300, 'USD'),
        baseCurrency: 'USD',
        splitAmounts: [8000, 4300],
      }),
    ).toEqual({
      fxRateToBase: '1',
      baseAmountMinor: 12300,
      splitBaseMinor: [8000, 4300],
    });
  });

  it('foreign currency: converts and allocates splits exactly', () => {
    const r = computeBaseAmounts({
      amount: money(100000, 'SDG'),
      baseCurrency: 'USD',
      rate: rate('0.001666'),
      splitAmounts: [33333, 33333, 33334],
    });
    expect(r.baseAmountMinor).toBe(167);
    expect(r.splitBaseMinor.reduce((a, b) => a + b, 0)).toBe(167);
  });

  it('transfer into base: uses the received leg and derives the rate', () => {
    const r = computeBaseAmounts({
      amount: money(6005000, 'SDG'),
      baseCurrency: 'USD',
      baseLegMinor: 10000,
      splitAmounts: [],
    });
    expect(r).toEqual({
      fxRateToBase: '0.001665278934',
      baseAmountMinor: 10000,
      splitBaseMinor: [],
    });
  });

  it('throws without a rate for foreign currency', () => {
    expect(() =>
      computeBaseAmounts({ amount: money(1, 'SDG'), baseCurrency: 'USD', splitAmounts: [] }),
    ).toThrow();
  });

  it('inverts rates for reverse lookups', () => {
    expect(invertRate(rate('600.5'))).toBe('0.001665278934');
    expect(invertRate(rate('0.5'))).toBe('2');
    expect(invertRate(rate('4') as DecimalRate)).toBe('0.25');
  });
});

describe('names, tags, search', () => {
  it('normalises names', () => {
    expect(normalizeName('  Al   Amin ')).toBe('al amin');
    expect(normalizeName('ＡＢＣ')).toBe('abc'); // full-width (NFKC)
  });

  it('cleans tags: trims, strips #, dedupes case-insensitively, drops blanks', () => {
    expect(cleanTagNames(['#Trip', 'trip ', ' ', 'Work  Lunch', 'work lunch'])).toEqual([
      'Trip',
      'Work Lunch',
    ]);
  });

  it('parses numeric search into minor amounts for every exponent', () => {
    expect(parseSearch('12.5')).toEqual({ text: '12.5', amountsMinor: [1250, 12500, 125000] });
    expect(parseSearch('12').amountsMinor).toEqual([12, 1200, 12000, 120000]);
    expect(parseSearch('1,250.00').amountsMinor).toContain(125000);
    expect(parseSearch('12,5', ',').amountsMinor).toContain(1250);
    expect(parseSearch('rent')).toEqual({ text: 'rent', amountsMinor: [] });
    expect(parseSearch('  ')).toEqual({ text: null, amountsMinor: [] });
  });

  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('drafts and trash', () => {
  it('keeps drafts for 10 minutes', () => {
    const t = 1_000_000;
    expect(isDraftFresh(t, t + 9 * 60_000)).toBe(true);
    expect(isDraftFresh(t, t + 10 * 60_000)).toBe(true);
    expect(isDraftFresh(t, t + 10 * 60_000 + 1)).toBe(false);
    expect(isDraftFresh(t + 5, t)).toBe(false); // clock moved back
  });

  it('computes the 30-day trash cutoff', () => {
    expect(trashCutoff(31 * 86_400_000)).toBe(86_400_000);
  });
});

describe('accounts and seed', () => {
  const ok = {
    name: 'Cash',
    type: 'cash',
    currency: 'USD',
    openingBalanceMinor: 0,
    openedOn: null,
    includeInTotals: true,
  } as const;
  it('validates accounts', () => {
    expect(validateAccount(ok)).toEqual([]);
    expect(validateAccount({ ...ok, openingBalanceMinor: -5000 })).toEqual([]); // card debt
    expect(validateAccount({ ...ok, name: '  ' })).toEqual(['name_empty']);
    expect(validateAccount({ ...ok, name: 'x'.repeat(41) })).toEqual(['name_too_long']);
    expect(validateAccount({ ...ok, type: 'crypto' as never })).toEqual(['type_invalid']);
    expect(validateAccount({ ...ok, currency: 'XYZ' as never })).toEqual(['currency_invalid']);
    expect(validateAccount({ ...ok, openingBalanceMinor: 1.5 })).toEqual([
      'opening_balance_invalid',
    ]);
    expect(validateAccount({ ...ok, openedOn: '2026-02-30' as never })).toEqual([
      'opened_on_invalid',
    ]);
  });

  it('seeds the baseline categories, with Savings moved out of income (G1)', () => {
    const keys = SEED_CATEGORIES.map((c) => c.seedKey);
    for (const k of [
      'bills',
      'auto',
      'home',
      'kids',
      'clothes',
      'food',
      'fuel',
      'entertainment',
      'health',
      'salary',
    ]) {
      expect(keys).toContain(k);
    }
    expect(keys).not.toContain('savings');
    expect(new Set(keys).size).toBe(keys.length);
  });
});
