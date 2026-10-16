import {
  applyKey,
  derive,
  displayExpression,
  initialState,
  reducer,
  reviveDraft,
  type Env,
  type FormState,
} from '@/features/quick-add/form-state';
import { localDate } from '@/domain';
import type { KeypadKey } from '@/ui';

const today = localDate('2026-10-16');
const env: Env = {
  currency: 'USD',
  toCurrency: null,
  baseCurrency: 'USD',
  decimalSeparator: '.',
  today,
  timeZone: 'Africa/Khartoum',
  now: Date.UTC(2026, 9, 16, 8),
};

function type(state: FormState, keys: string, currency = 'USD' as const): FormState {
  return [...keys].reduce(
    (s, k) =>
      reducer(s, {
        kind: 'key',
        key: (k === '.' ? 'decimal' : k === '<' ? 'back' : k) as KeypadKey,
        decimalSeparator: '.',
        currency,
      }),
    state,
  );
}

const start = () => initialState({ today, accountId: 'cash' });

describe('quick add: J2 happy path in 3 taps', () => {
  it('amount → category → ready to save', () => {
    let s = type(start(), '12.5'); // amount entry
    s = reducer(s, { kind: 'category', id: 'food' }); // tap 1 (category)
    const d = derive(s, env); // tap 2 would be Save
    expect(d.issues).toEqual([]);
    expect(d.input).toMatchObject({
      type: 'expense',
      accountId: 'cash',
      amountMinor: 1250,
      occurredOn: today,
      occurredAt: env.now,
      occurredTz: 'Africa/Khartoum',
      splits: [{ categoryId: 'food', amountMinor: 1250 }],
    });
  });

  it('calculator: 12+8.5 = 20.50', () => {
    const s = reducer(type(start(), '12+8.5'), { kind: 'category', id: 'food' });
    expect(derive(s, env).input?.amountMinor).toBe(2050);
  });
});

describe('quick add: J2 negative paths', () => {
  it('empty amount: save disabled, no error shown yet', () => {
    const d = derive(reducer(start(), { kind: 'category', id: 'food' }), env);
    expect(d.input).toBeNull();
    expect(d.issues).toContain('empty');
    expect(d.amountError).toBeNull();
  });

  it.each([
    ['0', 'zero'],
    ['5-9', 'negative'],
    ['1234567890123456', 'too_large'],
    ['1.234', 'too_many_decimals'],
  ])('%p → inline error %s, save disabled', (keys, error) => {
    const d = derive(reducer(type(start(), keys), { kind: 'category', id: 'food' }), env);
    expect(d.amountError).toBe(error);
    expect(d.input).toBeNull();
  });

  it('invalid expression "12++": error shown, last valid value kept', () => {
    const s = type(start(), '12++');
    expect(s.lastValidMinor).toBe(1200);
    const d = derive(reducer(s, { kind: 'category', id: 'food' }), env);
    expect(d.amountError).toBe('invalid');
    expect(d.input).toBeNull();
    // Fixing it recovers
    const fixed = type(s, '<8');
    expect(derive(reducer(fixed, { kind: 'category', id: 'food' }), env).input?.amountMinor).toBe(
      2000,
    );
  });

  it('backspace and clear', () => {
    expect(applyKey('12', 'back', '.')).toBe('1');
    expect(applyKey('', 'back', '.')).toBe('');
    expect(applyKey('12', 'clear', '.')).toBe('');
    expect(applyKey('12', 'decimal', ',')).toBe('12,');
    expect(applyKey('1'.repeat(40), '1', '.')).toHaveLength(40);
  });

  it('no category: save disabled', () => {
    expect(derive(type(start(), '5'), env).issues).toEqual(['splits_required']);
  });

  it('future date: noon in the local zone, still savable (warning comes from domain validation)', () => {
    const s = reducer(reducer(type(start(), '5'), { kind: 'category', id: 'food' }), {
      kind: 'date',
      date: localDate('2026-10-20'),
    });
    const d = derive(s, env);
    expect(d.input?.occurredOn).toBe('2026-10-20');
    expect(d.input?.occurredAt).toBe(Date.UTC(2026, 9, 20, 10)); // 12:00 Khartoum = 10:00Z
  });

  it('switching type clears categories', () => {
    const s = reducer(reducer(type(start(), '5'), { kind: 'category', id: 'food' }), {
      kind: 'type',
      type: 'income',
    });
    expect(s.categoryId).toBeNull();
    expect(reducer(s, { kind: 'type', type: 'income' })).toBe(s);
  });

  it('foreign-currency account requires a valid rate', () => {
    const s = reducer(type(start(), '600', 'SDG' as never), { kind: 'category', id: 'food' });
    const sdgEnv = { ...env, currency: 'SDG' as const };
    expect(derive(s, sdgEnv).issues).toEqual(['fx_rate_required']);
    expect(
      derive(reducer(s, { kind: 'field', field: 'rateText', value: 'abc' }), sdgEnv).issues,
    ).toEqual(['rate_invalid']);
    const ok = derive(reducer(s, { kind: 'field', field: 'rateText', value: '0,0017' }), sdgEnv);
    expect(ok.input?.fxRateToBase).toBe('0.0017');
  });

  it('note, payee and tags are trimmed', () => {
    let s = reducer(type(start(), '5'), { kind: 'category', id: 'food' });
    s = reducer(s, { kind: 'field', field: 'note', value: '  lunch ' });
    s = reducer(s, { kind: 'field', field: 'payee', value: ' ' });
    s = reducer(s, { kind: 'field', field: 'tags', value: 'work, , trip ' });
    expect(derive(s, env).input).toMatchObject({
      note: 'lunch',
      payeeName: null,
      tagNames: ['work', 'trip'],
    });
  });
});

describe('quick add: J3 split mode', () => {
  function split() {
    let s = reducer(type(start(), '123'), { kind: 'category', id: 'clothes' });
    s = reducer(s, { kind: 'splitOn', currency: 'USD' });
    return s;
  }

  it('starts with the full amount on the chosen category plus an empty row', () => {
    const s = split();
    expect(s.splits.map((r) => [r.categoryId, r.text])).toEqual([
      ['clothes', '123.00'],
      [null, ''],
    ]);
  });

  it('live remaining indicator; save blocked until it is zero', () => {
    let s = split();
    const [a, b] = s.splits;
    s = reducer(s, { kind: 'splitAmount', key: a?.key ?? 0, text: '80' });
    s = reducer(s, { kind: 'splitCategory', key: b?.key ?? 0, id: 'kids' });
    s = reducer(s, { kind: 'splitAmount', key: b?.key ?? 0, text: '40' });
    let d = derive(s, env);
    expect(d.remaining?.amountMinor).toBe(300);
    expect(d.issues).toEqual(['split_sum_mismatch']);
    expect(d.input).toBeNull();

    s = reducer(s, { kind: 'splitAmount', key: b?.key ?? 0, text: '43' });
    d = derive(s, env);
    expect(d.remaining?.amountMinor).toBe(0);
    expect(d.input?.splits).toEqual([
      { categoryId: 'clothes', amountMinor: 8000 },
      { categoryId: 'kids', amountMinor: 4300 },
    ]);
  });

  it('over-allocation shows a negative remaining', () => {
    let s = split();
    const [, b] = s.splits;
    s = reducer(s, { kind: 'splitCategory', key: b?.key ?? 0, id: 'kids' });
    s = reducer(s, { kind: 'splitAmount', key: b?.key ?? 0, text: '10' });
    expect(derive(s, env).remaining?.amountMinor).toBe(-1000);
  });

  it('rows without category or amount block saving', () => {
    const d = derive(split(), env);
    expect(d.issues).toEqual(expect.arrayContaining(['splits_required', 'split_amount_invalid']));
  });

  it('add/remove rows', () => {
    let s = reducer(split(), { kind: 'splitAdd' });
    expect(s.splits).toHaveLength(3);
    s = reducer(s, { kind: 'splitRemove', key: s.splits[2]?.key ?? 0 });
    expect(s.splits).toHaveLength(2);
    expect(new Set(reducer(s, { kind: 'splitAdd' }).splits.map((r) => r.key)).size).toBe(3);
  });

  it('removing split mode collapses to the largest category', () => {
    let s = split();
    const [a, b] = s.splits;
    s = reducer(s, { kind: 'splitAmount', key: a?.key ?? 0, text: '23' });
    s = reducer(s, { kind: 'splitCategory', key: b?.key ?? 0, id: 'kids' });
    s = reducer(s, { kind: 'splitAmount', key: b?.key ?? 0, text: '100' });
    s = reducer(s, { kind: 'splitOff', currency: 'USD', decimalSeparator: '.' });
    expect(s.splitMode).toBe(false);
    expect(s.categoryId).toBe('kids');
    expect(derive(s, env).input?.splits).toEqual([{ categoryId: 'kids', amountMinor: 12300 }]);
  });
});

describe('quick add: J4 transfers', () => {
  const tStart = () => reducer(type(start(), '100'), { kind: 'type', type: 'transfer' });

  it('same currency: no categories, no received amount needed', () => {
    const s = reducer(tStart(), { kind: 'toAccount', id: 'bank' });
    const d = derive(s, { ...env, toCurrency: 'USD' });
    expect(d.issues).toEqual([]);
    expect(d.input).toMatchObject({ type: 'transfer', toAccountId: 'bank', splits: [] });
  });

  it('needs a destination', () => {
    expect(derive(tStart(), env).issues).toEqual(['to_account_missing']);
  });

  it('cross-currency: received amount required; rate derived and shown', () => {
    let s = reducer(tStart(), { kind: 'toAccount', id: 'wallet' });
    const e = { ...env, toCurrency: 'SDG' as const };
    expect(derive(s, e).issues).toEqual(['to_amount_invalid']);
    s = reducer(s, { kind: 'toAmount', text: '60050' });
    const d = derive(s, e);
    expect(d.impliedRate).toBe('600.5');
    expect(d.input?.toAmountMinor).toBe(6005000);
  });

  it('choosing the source as destination clears the destination', () => {
    let s = reducer(tStart(), { kind: 'toAccount', id: 'bank' });
    s = reducer(s, { kind: 'account', id: 'bank' });
    expect(s.toAccountId).toBeNull();
  });
});

describe('edit mode keeps the original instant', () => {
  it('unchanged date: original occurredAt and zone; changed date: noon in current zone', () => {
    let s = reducer(type(start(), '5'), { kind: 'category', id: 'food' });
    s = {
      ...s,
      editId: 'tx',
      occurredOn: localDate('2026-10-01'),
      original: { occurredOn: localDate('2026-10-01'), occurredAt: 123, occurredTz: 'Asia/Dubai' },
    };
    expect(derive(s, env).input).toMatchObject({ occurredAt: 123, occurredTz: 'Asia/Dubai' });
    s = reducer(s, { kind: 'date', date: localDate('2026-10-02') });
    expect(derive(s, env).input).toMatchObject({
      occurredTz: 'Africa/Khartoum',
      occurredOn: '2026-10-02',
    });
  });
});

describe('drafts and display', () => {
  it('revives only well-formed new-entry drafts', () => {
    const s = type(start(), '12');
    expect(reviveDraft(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(reviveDraft(null)).toBeNull();
    expect(reviveDraft({ ...s, type: 'refund' })).toBeNull();
    expect(reviveDraft({ ...s, occurredOn: '2026-13-01' })).toBeNull();
    expect(reviveDraft({ ...s, editId: 'x' })).toBeNull();
    expect(reviveDraft({ ...s, splits: 'x' })).toBeNull();
  });

  it('renders operators and optional Arabic digits', () => {
    expect(displayExpression('12*3-4/2', false)).toBe('12×3\u22124÷2');
    expect(displayExpression('12.5', true)).toBe('١٢\u066B٥');
  });

  it('photos are de-duplicated', () => {
    let s = reducer(start(), { kind: 'photoAdd', uri: 'a' });
    s = reducer(s, { kind: 'photoAdd', uri: 'a' });
    expect(s.pendingPhotos).toEqual(['a']);
    expect(reducer(s, { kind: 'photoRemove', uri: 'a' }).pendingPhotos).toEqual([]);
  });
});
