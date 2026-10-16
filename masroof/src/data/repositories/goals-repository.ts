import { eq } from 'drizzle-orm';

import {
  convert,
  err,
  goalProgress,
  ok,
  validateGoal,
  type CurrencyCode,
  type GoalError,
  type GoalInput,
  type GoalProgress,
  type LocalDate,
  type Result,
} from '@/domain';

import type { DataDeps } from '../database';
import { goals } from '../schema';
import { withUnitOfWork } from '../unit-of-work';
import type { AccountsRepository } from './accounts-repository';
import type { FxRatesRepository } from './fx-rates-repository';

export type GoalRow = typeof goals.$inferSelect;

export type GoalWriteError = GoalError | 'account_missing' | 'not_found';

export type GoalStatus = Readonly<{
  goal: GoalRow;
  accountName: string | null;
  /** Linked account currency ≠ goal currency and no rate known. */
  missingRate: boolean;
  progress: GoalProgress | null;
}>;

/** Savings goals: progress is the linked account's balance (ADR-014). */
export function createGoalsRepository(
  deps: DataDeps & {
    today: () => LocalDate;
    accounts: AccountsRepository;
    fx: FxRatesRepository;
  },
) {
  const { db } = deps;
  const getRow = (id: string) => db.select().from(goals).where(eq(goals.id, id)).get();

  function check(input: GoalInput, isNew: boolean): GoalWriteError[] {
    const errors: GoalWriteError[] = validateGoal(input, deps.today(), isNew);
    if (input.linkedAccountId) {
      const a = deps.accounts.get(input.linkedAccountId);
      if (!a || a.deletedAt !== null) errors.push('account_missing');
    }
    return errors;
  }

  function status(g: GoalRow, today: LocalDate, balances: Map<string, number>): GoalStatus {
    const account = g.linkedAccountId ? deps.accounts.get(g.linkedAccountId) : undefined;
    if (!account) return { goal: g, accountName: null, missingRate: false, progress: null };
    const balance = balances.get(account.id) ?? account.openingBalanceMinor;
    let saved = balance;
    if (account.currency !== g.currency) {
      const rate = deps.fx.latest(
        account.currency as CurrencyCode,
        g.currency as CurrencyCode,
        today,
      );
      if (!rate) return { goal: g, accountName: account.name, missingRate: true, progress: null };
      saved = convert(
        { amountMinor: balance, currency: account.currency as CurrencyCode },
        rate,
        g.currency as CurrencyCode,
      ).amountMinor;
    }
    return {
      goal: g,
      accountName: account.name,
      missingRate: false,
      progress: goalProgress({
        savedMinor: saved,
        targetMinor: g.targetMinor,
        targetDate: (g.targetDate as LocalDate | null) ?? null,
        today,
      }),
    };
  }

  const api = {
    get: (id: string) => {
      const r = getRow(id);
      return r && r.deletedAt === null ? r : undefined;
    },

    list(): GoalRow[] {
      return deps.sql
        .all<{ id: string }>(
          `SELECT id FROM goals WHERE deleted_at IS NULL
           ORDER BY target_date IS NULL, target_date, created_at`,
        )
        .map((r) => getRow(r.id) as GoalRow);
    },

    statuses(today = deps.today()): GoalStatus[] {
      const balances = deps.accounts.balances(today);
      return api.list().map((g) => status(g, today, balances));
    },

    /** The goal's currency is the linked account's (no conversion needed by default). */
    create(input: GoalInput): Result<GoalRow, GoalWriteError[]> {
      const errors = check(input, true);
      if (errors.length > 0) return err(errors);
      const account = deps.accounts.get(input.linkedAccountId as string);
      return ok(
        withUnitOfWork(deps, ({ tx, now, newId, audit }) => {
          const row: GoalRow = {
            id: newId(),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
            name: input.name.trim(),
            targetMinor: input.targetMinor,
            currency: account?.currency as string,
            targetDate: input.targetDate,
            linkedAccountId: input.linkedAccountId,
          };
          tx.insert(goals).values(row).run();
          audit({ entity: 'goals', entityId: row.id, action: 'create', after: row });
          return row;
        }),
      );
    },

    update(id: string, input: GoalInput): Result<GoalRow, GoalWriteError[]> {
      const before = api.get(id);
      if (!before) return err(['not_found']);
      const errors = check(input, false);
      if (errors.length > 0) return err(errors);
      const account = deps.accounts.get(input.linkedAccountId as string);
      return ok(
        withUnitOfWork(deps, ({ tx, now, audit }) => {
          const after: GoalRow = {
            ...before,
            name: input.name.trim(),
            targetMinor: input.targetMinor,
            // Re-linking to another currency re-denominates the target as typed.
            currency: account?.currency ?? before.currency,
            targetDate: input.targetDate,
            linkedAccountId: input.linkedAccountId,
            updatedAt: now,
            version: before.version + 1,
          };
          tx.update(goals).set(after).where(eq(goals.id, id)).run();
          audit({ entity: 'goals', entityId: id, action: 'update', before, after });
          return after;
        }),
      );
    },

    delete(id: string): boolean {
      const before = api.get(id);
      if (!before) return false;
      withUnitOfWork(deps, ({ tx, now, audit }) => {
        tx.update(goals).set({ deletedAt: now, updatedAt: now }).where(eq(goals.id, id)).run();
        audit({ entity: 'goals', entityId: id, action: 'delete', before });
      });
      return true;
    },
  };
  return api;
}

export type GoalsRepository = ReturnType<typeof createGoalsRepository>;
