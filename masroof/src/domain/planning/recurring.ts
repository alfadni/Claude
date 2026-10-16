import { parseRate, type DecimalRate } from '../money/fx';
import type { SplitInput, TransactionInput, TransactionType } from '../ledger/transaction';
import { err, ok, type Result } from '../shared/result';
import type { LocalDate } from '../time/local-date';

export type RecurringMode = 'auto_post' | 'remind_only' | 'confirm_before_post';
export const RECURRING_MODES: readonly RecurringMode[] = [
  'auto_post',
  'confirm_before_post',
  'remind_only',
];

/** The transaction a rule creates, minus its date (spec 4: template JSON). */
export type RecurringTemplate = Readonly<{
  type: TransactionType;
  accountId: string;
  toAccountId: string | null;
  amountMinor: number;
  toAmountMinor: number | null;
  note: string | null;
  payeeName: string | null;
  tagNames: readonly string[];
  splits: readonly SplitInput[];
  /** Fallback rate if the FX table has none for the occurrence date. */
  fxRateToBase: DecimalRate | null;
}>;

export function templateFromInput(input: TransactionInput): RecurringTemplate {
  return {
    type: input.type,
    accountId: input.accountId,
    toAccountId: input.toAccountId ?? null,
    amountMinor: input.amountMinor,
    toAmountMinor: input.toAmountMinor ?? null,
    note: input.note ?? null,
    payeeName: input.payeeName ?? null,
    tagNames: [...(input.tagNames ?? [])],
    splits: input.splits.map((s) => ({
      categoryId: s.categoryId,
      amountMinor: s.amountMinor,
      note: s.note ?? null,
    })),
    fxRateToBase: input.fxRateToBase ?? null,
  };
}

export function inputFromTemplate(
  t: RecurringTemplate,
  when: { occurredOn: LocalDate; occurredAt: number; occurredTz: string },
  fxRateToBase: DecimalRate | null,
): TransactionInput {
  return {
    type: t.type,
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    amountMinor: t.amountMinor,
    toAmountMinor: t.toAmountMinor,
    note: t.note,
    payeeName: t.payeeName,
    tagNames: t.tagNames,
    splits: t.splits,
    fxRateToBase: fxRateToBase ?? t.fxRateToBase,
    ...when,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1000;
const strOrNull = (v: unknown): v is string | null => v === null || v === undefined || str(v);
const int = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/**
 * Template JSON is untrusted (backup restore, future sync): parse defensively.
 * Business rules (amount ranges, split sums) are checked later by
 * validateTransaction when an occurrence is created.
 */
export function parseTemplate(json: string): Result<RecurringTemplate, 'template_invalid'> {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return err('template_invalid');
  }
  if (!isObj(v)) return err('template_invalid');
  const type = v.type;
  if (type !== 'expense' && type !== 'income' && type !== 'transfer') {
    return err('template_invalid');
  }
  if (!str(v.accountId) || !strOrNull(v.toAccountId) || !int(v.amountMinor)) {
    return err('template_invalid');
  }
  if (!(v.toAmountMinor === null || v.toAmountMinor === undefined || int(v.toAmountMinor))) {
    return err('template_invalid');
  }
  if (!strOrNull(v.note) || !strOrNull(v.payeeName)) return err('template_invalid');
  const tags = v.tagNames ?? [];
  if (!Array.isArray(tags) || !tags.every(str)) return err('template_invalid');
  const splitsRaw = v.splits ?? [];
  if (!Array.isArray(splitsRaw)) return err('template_invalid');
  const splits: SplitInput[] = [];
  for (const s of splitsRaw) {
    if (!isObj(s) || !str(s.categoryId) || !int(s.amountMinor) || !strOrNull(s.note)) {
      return err('template_invalid');
    }
    splits.push({ categoryId: s.categoryId, amountMinor: s.amountMinor, note: s.note ?? null });
  }
  const rate = v.fxRateToBase ?? null;
  let fxRateToBase: DecimalRate | null = null;
  if (rate !== null) {
    const parsed = typeof rate === 'string' ? parseRate(rate) : null;
    if (!parsed?.ok) return err('template_invalid');
    fxRateToBase = parsed.value;
  }
  return ok({
    type,
    accountId: v.accountId,
    toAccountId: (v.toAccountId as string | null | undefined) ?? null,
    amountMinor: v.amountMinor,
    toAmountMinor: (v.toAmountMinor as number | null | undefined) ?? null,
    note: (v.note as string | null | undefined) ?? null,
    payeeName: (v.payeeName as string | null | undefined) ?? null,
    tagNames: tags,
    splits,
    fxRateToBase,
  });
}

/** Template with every occurrence of `fromId` replaced (category merge). */
export function replaceCategory(
  t: RecurringTemplate,
  fromId: string,
  toId: string,
): RecurringTemplate {
  return {
    ...t,
    splits: t.splits.map((s) => (s.categoryId === fromId ? { ...s, categoryId: toId } : s)),
  };
}
