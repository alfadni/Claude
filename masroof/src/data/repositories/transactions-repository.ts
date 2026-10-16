import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import {
  computeBaseAmounts,
  inputFromTemplate,
  recurrenceKey,
  startOfDayInZone,
  deriveRate,
  err,
  likePattern,
  money,
  ok,
  trashCutoff,
  validateTransaction,
  type CurrencyCode,
  type EditScope,
  type DecimalRate,
  type LocalDate,
  type RecurringTemplate,
  type Result,
  type TransactionInput,
  type TransactionType,
  type TxError,
  type TxWarning,
} from '@/domain';

import type { DataDeps } from '../database';
import {
  attachments,
  auditLog,
  payees,
  recurringRules,
  tags,
  transactionSplits,
  transactionTags,
  transactions,
} from '../schema';
import { withUnitOfWork, type UnitOfWork } from '../unit-of-work';
import type { AccountsRepository } from './accounts-repository';
import type { CategoriesRepository } from './categories-repository';
import type { FxRatesRepository } from './fx-rates-repository';
import type { NamesRepository } from './names-repository';
import type { SettingsRepository } from './settings-repository';

export type TransactionRow = typeof transactions.$inferSelect;
export type SplitRow = typeof transactionSplits.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

export type TransactionDetail = TransactionRow & {
  splits: SplitRow[];
  tags: { id: string; name: string }[];
  payeeName: string | null;
  attachments: AttachmentRow[];
};

export type WriteError = TxError | 'not_found' | 'scope_required';

export type ListFilter = Readonly<{
  text?: string | null;
  amountsMinor?: readonly number[];
  /** Inclusive local-date bounds. */
  from?: LocalDate | null;
  to?: LocalDate | null;
  types?: readonly TransactionType[];
  accountIds?: readonly string[];
  categoryIds?: readonly string[];
  tagIds?: readonly string[];
}>;

export type ListItem = Readonly<{
  id: string;
  type: TransactionType;
  accountId: string;
  toAccountId: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  toAmountMinor: number | null;
  toCurrency: CurrencyCode | null;
  baseAmountMinor: number;
  occurredAt: number;
  occurredOn: LocalDate;
  note: string | null;
  payeeName: string | null;
  categoryId: string | null;
  splitCount: number;
  attachmentCount: number;
}>;

export type Cursor = Readonly<{ occurredAt: number; id: string }>;

export type PendingItem = ListItem &
  Readonly<{ ruleId: string; mode: 'auto_post' | 'remind_only' | 'confirm_before_post' }>;

export type OccurrenceOutcome = 'created' | 'exists';

/** The editable input a stored transaction corresponds to (confirm with edits, re-validation). */
export function inputFromDetail(d: TransactionDetail): TransactionInput {
  return {
    type: d.type,
    accountId: d.accountId,
    toAccountId: d.toAccountId,
    amountMinor: d.amountMinor,
    toAmountMinor: d.toAmountMinor,
    occurredAt: d.occurredAt,
    occurredTz: d.occurredTz,
    occurredOn: d.occurredOn as LocalDate,
    note: d.note,
    payeeName: d.payeeName,
    tagNames: d.tags.map((t) => t.name),
    splits: d.splits.map((s) => ({
      categoryId: s.categoryId,
      amountMinor: s.amountMinor,
      note: s.note,
    })),
    fxRateToBase: d.fxRateToBase as DecimalRate,
  };
}

type Deps = DataDeps & {
  today: () => LocalDate;
  settings: SettingsRepository;
  accounts: AccountsRepository;
  categories: CategoriesRepository;
  names: NamesRepository;
  fx: FxRatesRepository;
};

export function createTransactionsRepository(deps: Deps) {
  const { db } = deps;

  function getRow(id: string): TransactionRow | undefined {
    return db.select().from(transactions).where(eq(transactions.id, id)).get();
  }

  function detail(id: string, options: { includeDeletedChildren?: boolean } = {}) {
    const row = getRow(id);
    if (!row) return undefined;
    const liveOnly = !options.includeDeletedChildren;
    const splits = db
      .select()
      .from(transactionSplits)
      .where(
        liveOnly
          ? and(eq(transactionSplits.transactionId, id), isNull(transactionSplits.deletedAt))
          : eq(transactionSplits.transactionId, id),
      )
      .orderBy(asc(transactionSplits.sortOrder))
      .all();
    const tagRows = db
      .select({ id: tags.id, name: tags.name })
      .from(transactionTags)
      .innerJoin(tags, eq(tags.id, transactionTags.tagId))
      .where(eq(transactionTags.transactionId, id))
      .all();
    const payee = row.payeeId
      ? db.select().from(payees).where(eq(payees.id, row.payeeId)).get()
      : undefined;
    const files = db
      .select()
      .from(attachments)
      .where(
        liveOnly
          ? and(eq(attachments.transactionId, id), isNull(attachments.deletedAt))
          : eq(attachments.transactionId, id),
      )
      .all();
    const d: TransactionDetail = {
      ...row,
      splits,
      tags: tagRows,
      payeeName: payee?.name ?? null,
      attachments: files,
    };
    return d;
  }

  /** Validate + derive everything written to the row. */
  function prepare(input: TransactionInput, existing?: TransactionDetail) {
    const baseCurrency = deps.settings.get('baseCurrency');
    const today = deps.today();
    const existingCategoryIds = new Set(existing?.splits.map((s) => s.categoryId) ?? []);
    const facts = (id: string) => {
      const f = deps.accounts.facts(id, today);
      // Editing: the old amount is already in the balance; don't double count it.
      if (f && existing && existing.accountId === id) {
        return { ...f, balanceMinor: f.balanceMinor + existing.amountMinor };
      }
      return f;
    };
    const validation = validateTransaction(input, {
      baseCurrency,
      today,
      account: facts,
      category: (id) => deps.categories.facts(id),
      existingCategoryIds,
    });
    if (validation.errors.length > 0) return { errors: validation.errors } as const;

    const account = deps.accounts.get(input.accountId);
    const toAccount = input.toAccountId ? deps.accounts.get(input.toAccountId) : undefined;
    const currency = account?.currency as CurrencyCode;
    const toCurrency = (toAccount?.currency as CurrencyCode | undefined) ?? null;
    const isTransfer = input.type === 'transfer';
    const toAmountMinor = isTransfer
      ? toCurrency === currency
        ? input.amountMinor
        : (input.toAmountMinor ?? null)
      : null;

    const base = computeBaseAmounts({
      amount: money(input.amountMinor, currency),
      baseCurrency,
      rate: input.fxRateToBase ?? null,
      baseLegMinor: isTransfer && toCurrency === baseCurrency ? toAmountMinor : null,
      splitAmounts: input.splits.map((s) => s.amountMinor),
    });
    return {
      warnings: validation.warnings,
      currency,
      toCurrency: isTransfer ? toCurrency : null,
      toAmountMinor,
      base,
      baseCurrency,
    } as const;
  }

  function writeChildren(
    uow: UnitOfWork,
    txId: string,
    input: TransactionInput,
    splitBase: number[],
  ) {
    input.splits.forEach((s, i) => {
      uow.tx
        .insert(transactionSplits)
        .values({
          id: uow.newId(),
          createdAt: uow.now,
          updatedAt: uow.now,
          deletedAt: null,
          version: 1,
          transactionId: txId,
          categoryId: s.categoryId,
          amountMinor: s.amountMinor,
          baseAmountMinor: splitBase[i] ?? 0,
          note: s.note?.trim() || null,
          sortOrder: i,
        })
        .run();
    });
    const tagIds = deps.names.upsertTags(input.tagNames ?? []);
    uow.tx.delete(transactionTags).where(eq(transactionTags.transactionId, txId)).run();
    for (const tagId of tagIds) {
      uow.tx
        .insert(transactionTags)
        .values({ transactionId: txId, tagId, createdAt: uow.now })
        .run();
    }
  }

  /** Remember rates the user typed or a cross-currency transfer implied. */
  function rememberRate(p: ReturnType<typeof prepare>, input: TransactionInput) {
    if ('errors' in p) return;
    if (p.currency !== p.baseCurrency) {
      deps.fx.record(p.currency, p.baseCurrency, p.base.fxRateToBase, input.occurredOn);
    } else if (p.toCurrency && p.toCurrency !== p.baseCurrency && p.toAmountMinor) {
      // Base → foreign transfer: 1 foreign = sent / received base units.
      const implied = deriveRate(
        money(p.toAmountMinor, p.toCurrency),
        money(input.amountMinor, p.currency),
      );
      deps.fx.record(p.toCurrency, p.baseCurrency, implied, input.occurredOn);
    }
  }

  const api = {
    get: (id: string) => detail(id),

    create(input: TransactionInput): Result<{ id: string; warnings: TxWarning[] }, WriteError[]> {
      const p = prepare(input);
      if ('errors' in p) return err(p.errors ? [...p.errors] : []);
      return withUnitOfWork(deps, (uow) => {
        const id = uow.newId();
        const row: TransactionRow = {
          id,
          createdAt: uow.now,
          updatedAt: uow.now,
          deletedAt: null,
          version: 1,
          type: input.type,
          accountId: input.accountId,
          toAccountId: input.type === 'transfer' ? (input.toAccountId ?? null) : null,
          amountMinor: input.amountMinor,
          currency: p.currency,
          toAmountMinor: p.toAmountMinor,
          toCurrency: p.toCurrency,
          fxRateToBase: p.base.fxRateToBase,
          baseAmountMinor: p.base.baseAmountMinor,
          occurredAt: input.occurredAt,
          occurredTz: input.occurredTz,
          occurredOn: input.occurredOn,
          payeeId: deps.names.upsertPayee(input.payeeName),
          note: input.note?.trim() || null,
          status: 'posted',
          recurringRuleId: null,
          recurrenceKey: null,
        };
        uow.tx.insert(transactions).values(row).run();
        writeChildren(uow, id, input, p.base.splitBaseMinor);
        rememberRate(p, input);
        deps.settings.set('lastAccountId', input.accountId);
        uow.audit({ entity: 'transactions', entityId: id, action: 'create', after: detail(id) });
        return ok({ id, warnings: [...p.warnings] });
      });
    },

    /**
     * Edit in place. Old splits are soft-deleted (kept for audit/undo) and new
     * ones written. A recurring-generated transaction requires a scope (J7).
     */
    update(
      id: string,
      input: TransactionInput,
      scope?: EditScope,
    ): Result<{ warnings: TxWarning[] }, WriteError[]> {
      const before = detail(id);
      if (!before || before.deletedAt !== null) return err(['not_found']);
      if (before.recurringRuleId && !scope) return err(['scope_required']);
      const p = prepare(input, before);
      if ('errors' in p) return err(p.errors ? [...p.errors] : []);
      return withUnitOfWork(deps, (uow) => {
        uow.tx
          .update(transactions)
          .set({
            type: input.type,
            accountId: input.accountId,
            toAccountId: input.type === 'transfer' ? (input.toAccountId ?? null) : null,
            amountMinor: input.amountMinor,
            currency: p.currency,
            toAmountMinor: p.toAmountMinor,
            toCurrency: p.toCurrency,
            fxRateToBase: p.base.fxRateToBase,
            baseAmountMinor: p.base.baseAmountMinor,
            occurredAt: input.occurredAt,
            occurredTz: input.occurredTz,
            occurredOn: input.occurredOn,
            payeeId: deps.names.upsertPayee(input.payeeName),
            note: input.note?.trim() || null,
            updatedAt: uow.now,
            version: before.version + 1,
          })
          .where(eq(transactions.id, id))
          .run();
        uow.tx
          .update(transactionSplits)
          .set({ deletedAt: uow.now, updatedAt: uow.now })
          .where(and(eq(transactionSplits.transactionId, id), isNull(transactionSplits.deletedAt)))
          .run();
        writeChildren(uow, id, input, p.base.splitBaseMinor);
        rememberRate(p, input);

        if (scope === 'this_and_future' && before.recurringRuleId) {
          const rule = uow.tx
            .select()
            .from(recurringRules)
            .where(eq(recurringRules.id, before.recurringRuleId))
            .get();
          if (rule) {
            const template = {
              ...(JSON.parse(rule.templateJson) as Record<string, unknown>),
              type: input.type,
              accountId: input.accountId,
              toAccountId: input.toAccountId ?? null,
              amountMinor: input.amountMinor,
              toAmountMinor: input.toAmountMinor ?? null,
              note: input.note ?? null,
              payeeName: input.payeeName ?? null,
              splits: input.splits,
              tagNames: input.tagNames ?? [],
            };
            const after = {
              ...rule,
              templateJson: JSON.stringify(template),
              updatedAt: uow.now,
              version: rule.version + 1,
            };
            uow.tx.update(recurringRules).set(after).where(eq(recurringRules.id, rule.id)).run();
            uow.audit({
              entity: 'recurring_rules',
              entityId: rule.id,
              action: 'update',
              before: rule,
              after,
            });
          }
        }
        uow.audit({
          entity: 'transactions',
          entityId: id,
          action: 'update',
          before,
          after: detail(id),
        });
        return ok({ warnings: [...p.warnings] });
      });
    },

    /** Soft delete: the transaction and its live children share one deleted_at. */
    delete(id: string): Result<{ deletedAt: number }, 'not_found'> {
      const before = detail(id);
      if (!before || before.deletedAt !== null) return err('not_found');
      return withUnitOfWork(deps, (uow) => {
        const at = uow.now;
        uow.tx
          .update(transactions)
          .set({ deletedAt: at, updatedAt: at })
          .where(eq(transactions.id, id))
          .run();
        uow.tx
          .update(transactionSplits)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(transactionSplits.transactionId, id), isNull(transactionSplits.deletedAt)))
          .run();
        uow.tx
          .update(attachments)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(attachments.transactionId, id), isNull(attachments.deletedAt)))
          .run();
        uow.audit({ entity: 'transactions', entityId: id, action: 'delete', before });
        return ok({ deletedAt: at });
      });
    },

    /**
     * Undo / restore from Trash. Brings back exactly what the delete removed:
     * children whose deleted_at equals the parent's, not splits replaced by
     * earlier edits.
     */
    restore(id: string): Result<true, 'not_found' | 'not_deleted'> {
      const row = getRow(id);
      if (!row) return err('not_found');
      if (row.deletedAt === null) return err('not_deleted');
      const at = row.deletedAt;
      return withUnitOfWork(deps, (uow) => {
        uow.tx
          .update(transactions)
          .set({ deletedAt: null, updatedAt: uow.now, version: row.version + 1 })
          .where(eq(transactions.id, id))
          .run();
        uow.tx
          .update(transactionSplits)
          .set({ deletedAt: null, updatedAt: uow.now })
          .where(and(eq(transactionSplits.transactionId, id), eq(transactionSplits.deletedAt, at)))
          .run();
        uow.tx
          .update(attachments)
          .set({ deletedAt: null, updatedAt: uow.now })
          .where(and(eq(attachments.transactionId, id), eq(attachments.deletedAt, at)))
          .run();
        uow.audit({ entity: 'transactions', entityId: id, action: 'restore', after: detail(id) });
        return ok(true as const);
      });
    },

    /** Deleted within the retention window, newest first. */
    listTrash(): ListItem[] {
      return query({ deleted: true, cutoff: trashCutoff(deps.now()) }, null, 200);
    },

    /**
     * Permanently remove transactions deleted more than 30 days ago, including
     * their audit history (so "deleted" data does not linger in before_json).
     * Returns attachment file paths for the caller to delete from disk.
     */
    purgeExpired(): { purged: number; filePaths: string[] } {
      const cutoff = trashCutoff(deps.now());
      const ids = deps.sql
        .all<{ id: string }>(
          'SELECT id FROM transactions WHERE deleted_at IS NOT NULL AND deleted_at < ?',
          [cutoff],
        )
        .map((r) => r.id);
      if (ids.length === 0) return { purged: 0, filePaths: [] };
      return withUnitOfWork(deps, (uow) => {
        const filePaths = uow.tx
          .select({ p: attachments.filePath })
          .from(attachments)
          .where(inArray(attachments.transactionId, ids))
          .all()
          .map((r) => r.p);
        uow.tx
          .delete(auditLog)
          .where(and(eq(auditLog.entity, 'transactions'), inArray(auditLog.entityId, ids)))
          .run();
        uow.tx.delete(transactions).where(inArray(transactions.id, ids)).run(); // cascades
        for (const id of ids) uow.audit({ entity: 'transactions', entityId: id, action: 'purge' });
        return { purged: ids.length, filePaths };
      });
    },

    /**
     * Write one occurrence of a recurring rule (ADR-013). Idempotent on the
     * recurrence key: an existing row with that key (any status, even
     * deleted) is never duplicated. Joins the caller's unit of work.
     */
    createOccurrence(params: {
      ruleId: string;
      date: LocalDate;
      timeZone: string;
      template: RecurringTemplate;
      status: 'posted' | 'pending_recurring';
    }): Result<OccurrenceOutcome, WriteError[]> {
      const key = recurrenceKey(params.ruleId, params.date);
      const exists =
        deps.sql.all('SELECT 1 FROM transactions WHERE recurrence_key = ?', [key]).length > 0;
      if (exists) return ok('exists');
      const account = deps.accounts.get(params.template.accountId);
      const baseCurrency = deps.settings.get('baseCurrency');
      const rate =
        account && account.currency !== baseCurrency
          ? deps.fx.latest(account.currency as CurrencyCode, baseCurrency, params.date)
          : null;
      const input = inputFromTemplate(
        params.template,
        {
          occurredOn: params.date,
          occurredAt: startOfDayInZone(params.date, params.timeZone) + 12 * 3_600_000,
          occurredTz: params.timeZone,
        },
        rate,
      );
      const p = prepare(input);
      if ('errors' in p) return err(p.errors ? [...p.errors] : []);
      return withUnitOfWork(deps, (uow) => {
        const id = uow.newId();
        const row: TransactionRow = {
          id,
          createdAt: uow.now,
          updatedAt: uow.now,
          deletedAt: null,
          version: 1,
          type: input.type,
          accountId: input.accountId,
          toAccountId: input.type === 'transfer' ? (input.toAccountId ?? null) : null,
          amountMinor: input.amountMinor,
          currency: p.currency,
          toAmountMinor: p.toAmountMinor,
          toCurrency: p.toCurrency,
          fxRateToBase: p.base.fxRateToBase,
          baseAmountMinor: p.base.baseAmountMinor,
          occurredAt: input.occurredAt,
          occurredTz: input.occurredTz,
          occurredOn: input.occurredOn,
          payeeId: deps.names.upsertPayee(input.payeeName),
          note: input.note?.trim() || null,
          status: params.status,
          recurringRuleId: params.ruleId,
          recurrenceKey: key,
        };
        uow.tx.insert(transactions).values(row).run();
        writeChildren(uow, id, input, p.base.splitBaseMinor);
        uow.audit({ entity: 'transactions', entityId: id, action: 'create', after: detail(id) });
        return ok('created' as const);
      });
    },

    /** Make an existing transaction occurrence #1 of a new rule. */
    linkToRule(id: string, ruleId: string, date: LocalDate): void {
      const before = getRow(id);
      if (!before) return;
      withUnitOfWork(deps, (uow) => {
        const after = {
          ...before,
          recurringRuleId: ruleId,
          recurrenceKey: recurrenceKey(ruleId, date),
          updatedAt: uow.now,
          version: before.version + 1,
        };
        uow.tx.update(transactions).set(after).where(eq(transactions.id, id)).run();
        uow.audit({ entity: 'transactions', entityId: id, action: 'update', before, after });
      });
    },

    /** Occurrences waiting in the Upcoming inbox, oldest first. */
    listPending(): PendingItem[] {
      return deps.sql.all<PendingItem>(
        `SELECT t.id, t.type, t.account_id AS accountId, t.to_account_id AS toAccountId,
                t.amount_minor AS amountMinor, t.currency, t.to_amount_minor AS toAmountMinor,
                t.to_currency AS toCurrency, t.base_amount_minor AS baseAmountMinor,
                t.occurred_at AS occurredAt, t.occurred_on AS occurredOn, t.note,
                p.name AS payeeName,
                (SELECT s.category_id FROM transaction_splits s WHERE s.transaction_id = t.id
                   AND s.deleted_at IS NULL ORDER BY s.amount_minor DESC, s.sort_order LIMIT 1) AS categoryId,
                (SELECT count(*) FROM transaction_splits s WHERE s.transaction_id = t.id
                   AND s.deleted_at IS NULL) AS splitCount,
                0 AS attachmentCount,
                r.id AS ruleId, r.mode AS mode
         FROM transactions t
         JOIN recurring_rules r ON r.id = t.recurring_rule_id
         LEFT JOIN payees p ON p.id = t.payee_id
         WHERE t.status = 'pending_recurring' AND t.deleted_at IS NULL
         ORDER BY t.occurred_on, t.id`,
      );
    },

    /**
     * Post a pending occurrence, optionally with a new amount (J5 "confirm /
     * edit amount"). Re-validated like any entry: an archived account or
     * category blocks it with the usual errors.
     */
    confirmPending(
      id: string,
      amountMinor?: number,
    ): Result<{ warnings: TxWarning[] }, WriteError[] | ['not_pending']> {
      const d = detail(id);
      if (!d || d.deletedAt !== null) return err(['not_found']);
      if (d.status !== 'pending_recurring') return err(['not_pending']);
      let input = inputFromDetail(d);
      if (amountMinor !== undefined && amountMinor !== d.amountMinor) {
        if (input.splits.length > 1) return err(['split_sum_mismatch']);
        input = {
          ...input,
          amountMinor,
          // Same-currency transfers mirror the amount; cross-currency keeps its received leg.
          toAmountMinor: d.toCurrency === d.currency ? amountMinor : input.toAmountMinor,
          splits: input.splits.map((s) => ({ ...s, amountMinor })),
        };
      }
      return withUnitOfWork(deps, (uow) => {
        // update() validates before writing, so an error here has written nothing.
        const r = api.update(id, input, 'this_only');
        if (!r.ok) return r;
        uow.tx
          .update(transactions)
          .set({ status: 'posted', updatedAt: uow.now })
          .where(eq(transactions.id, id))
          .run();
        uow.audit({
          entity: 'transactions',
          entityId: id,
          action: 'update',
          after: { status: 'posted' },
        });
        return ok({ warnings: r.value.warnings });
      });
    },

    /** Skip a pending occurrence: voided, keeping its key so it never returns. */
    skipPending(id: string): Result<true, 'not_found' | 'not_pending'> {
      const before = getRow(id);
      if (!before || before.deletedAt !== null) return err('not_found');
      if (before.status !== 'pending_recurring') return err('not_pending');
      return withUnitOfWork(deps, (uow) => {
        const after = {
          ...before,
          status: 'void' as const,
          updatedAt: uow.now,
          version: before.version + 1,
        };
        uow.tx.update(transactions).set(after).where(eq(transactions.id, id)).run();
        uow.audit({ entity: 'transactions', entityId: id, action: 'update', before, after });
        return ok(true as const);
      });
    },

    list(filter: ListFilter, cursor: Cursor | null, limit = 50): ListItem[] {
      return query({ filter }, cursor, limit);
    },
  };
  return api;

  function query(
    opts: { filter?: ListFilter; deleted?: boolean; cutoff?: number },
    cursor: Cursor | null,
    limit: number,
  ): ListItem[] {
    const where: string[] = [];
    const params: (string | number | null)[] = [];
    const f = opts.filter ?? {};
    // Pending/void recurring occurrences live in the Upcoming inbox only (ADR-013).
    where.push(`t.status = 'posted'`);
    if (opts.deleted) {
      where.push('t.deleted_at IS NOT NULL AND t.deleted_at >= ?');
      params.push(opts.cutoff ?? 0);
    } else {
      where.push('t.deleted_at IS NULL');
    }
    if (f.from) {
      where.push('t.occurred_on >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('t.occurred_on <= ?');
      params.push(f.to);
    }
    const inList = (col: string, values: readonly string[] | undefined) => {
      if (!values || values.length === 0) return;
      where.push(`${col} IN (${values.map(() => '?').join(',')})`);
      params.push(...values);
    };
    inList('t.type', f.types);
    if (f.accountIds && f.accountIds.length > 0) {
      const marks = f.accountIds.map(() => '?').join(',');
      where.push(`(t.account_id IN (${marks}) OR t.to_account_id IN (${marks}))`);
      params.push(...f.accountIds, ...f.accountIds);
    }
    if (f.categoryIds && f.categoryIds.length > 0) {
      where.push(
        `EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id AND s.deleted_at IS NULL AND s.category_id IN (${f.categoryIds.map(() => '?').join(',')}))`,
      );
      params.push(...f.categoryIds);
    }
    if (f.tagIds && f.tagIds.length > 0) {
      where.push(
        `EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id IN (${f.tagIds.map(() => '?').join(',')}))`,
      );
      params.push(...f.tagIds);
    }
    if (f.text) {
      const textConds = [`t.note LIKE ? ESCAPE '\\'`, `p.name LIKE ? ESCAPE '\\'`];
      const pattern = likePattern(f.text);
      params.push(pattern, pattern);
      if (f.amountsMinor && f.amountsMinor.length > 0) {
        textConds.push(`t.amount_minor IN (${f.amountsMinor.map(() => '?').join(',')})`);
        params.push(...f.amountsMinor);
      }
      where.push(`(${textConds.join(' OR ')})`);
    }
    if (cursor) {
      where.push('(t.occurred_at < ? OR (t.occurred_at = ? AND t.id < ?))');
      params.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
    }
    params.push(limit);
    const order = opts.deleted ? 't.deleted_at DESC, t.id DESC' : 't.occurred_at DESC, t.id DESC';
    return deps.sql.all<ListItem>(
      `SELECT t.id, t.type, t.account_id AS accountId, t.to_account_id AS toAccountId,
              t.amount_minor AS amountMinor, t.currency, t.to_amount_minor AS toAmountMinor,
              t.to_currency AS toCurrency, t.base_amount_minor AS baseAmountMinor,
              t.occurred_at AS occurredAt, t.occurred_on AS occurredOn, t.note,
              p.name AS payeeName,
              (SELECT s.category_id FROM transaction_splits s WHERE s.transaction_id = t.id
                 AND (s.deleted_at IS NULL OR s.deleted_at = t.deleted_at)
                 ORDER BY s.amount_minor DESC, s.sort_order LIMIT 1) AS categoryId,
              (SELECT count(*) FROM transaction_splits s WHERE s.transaction_id = t.id
                 AND (s.deleted_at IS NULL OR s.deleted_at = t.deleted_at)) AS splitCount,
              (SELECT count(*) FROM attachments a WHERE a.transaction_id = t.id
                 AND (a.deleted_at IS NULL OR a.deleted_at = t.deleted_at)) AS attachmentCount
       FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${order} LIMIT ?`,
      params,
    );
  }
}

export type TransactionsRepository = ReturnType<typeof createTransactionsRepository>;
