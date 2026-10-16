import { and, asc, eq, isNull } from 'drizzle-orm';

import {
  err,
  ok,
  validateAccount,
  type AccountError,
  type AccountFacts,
  type AccountInput,
  type CurrencyCode,
  type LocalDate,
  type Result,
} from '@/domain';

import type { DataDeps } from '../database';
import { accounts } from '../schema';
import { withUnitOfWork } from '../unit-of-work';

export type AccountRow = typeof accounts.$inferSelect;

const BALANCE_SQL = `
  SELECT a.id AS id,
    a.opening_balance_minor
    + coalesce((SELECT sum(CASE WHEN t.type = 'income' THEN t.amount_minor ELSE -t.amount_minor END)
                FROM transactions t
                WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.status = 'posted'
                  AND t.occurred_on <= ?), 0)
    + coalesce((SELECT sum(t.to_amount_minor)
                FROM transactions t
                WHERE t.to_account_id = a.id AND t.deleted_at IS NULL AND t.status = 'posted'
                  AND t.occurred_on <= ?), 0) AS balance
  FROM accounts a
  WHERE a.deleted_at IS NULL`;

export function createAccountsRepository(deps: DataDeps) {
  const { db } = deps;

  function get(id: string): AccountRow | undefined {
    return db.select().from(accounts).where(eq(accounts.id, id)).get();
  }

  /** Balances as of `asOf` (scheduled/future transactions excluded), in each account's currency. */
  function balances(asOf: LocalDate): Map<string, number> {
    const rows = deps.sql.all<{ id: string; balance: number }>(BALANCE_SQL, [asOf, asOf]);
    return new Map(rows.map((r) => [r.id, r.balance]));
  }

  function hasTransactions(id: string): boolean {
    return (
      deps.sql.all(
        `SELECT 1 FROM transactions WHERE (account_id = ? OR to_account_id = ?) LIMIT 1`,
        [id, id],
      ).length > 0
    );
  }

  return {
    get,
    balances,
    hasTransactions,

    list(options: { includeArchived?: boolean } = {}): AccountRow[] {
      const where = options.includeArchived
        ? isNull(accounts.deletedAt)
        : and(isNull(accounts.deletedAt), eq(accounts.isArchived, false));
      return db
        .select()
        .from(accounts)
        .where(where)
        .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt))
        .all();
    },

    facts(id: string, asOf: LocalDate): AccountFacts | undefined {
      const a = get(id);
      if (!a) return undefined;
      return {
        id: a.id,
        currency: a.currency as CurrencyCode,
        isArchived: a.isArchived,
        isDeleted: a.deletedAt !== null,
        openedOn: (a.openedOn as LocalDate | null) ?? null,
        balanceMinor: balances(asOf).get(a.id) ?? a.openingBalanceMinor,
      };
    },

    create(input: AccountInput): Result<AccountRow, AccountError[]> {
      const errors = validateAccount(input);
      if (errors.length > 0) return err(errors);
      return ok(
        withUnitOfWork(deps, ({ tx, now, newId, audit }) => {
          const count = deps.sql.all<{ n: number }>(
            'SELECT count(*) AS n FROM accounts WHERE deleted_at IS NULL',
          )[0];
          const row: AccountRow = {
            id: newId(),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
            name: input.name.trim(),
            type: input.type,
            currency: input.currency,
            openingBalanceMinor: input.openingBalanceMinor,
            openedOn: input.openedOn,
            icon: input.icon ?? null,
            color: input.color ?? null,
            isArchived: false,
            includeInTotals: input.includeInTotals,
            sortOrder: count?.n ?? 0,
          };
          tx.insert(accounts).values(row).run();
          audit({ entity: 'accounts', entityId: row.id, action: 'create', after: row });
          return row;
        }),
      );
    },

    update(id: string, input: AccountInput): Result<AccountRow, AccountError[] | ['not_found']> {
      const before = get(id);
      if (!before || before.deletedAt !== null) return err(['not_found']);
      const errors = validateAccount(input);
      // Changing currency would silently relabel history (G5): blocked once used.
      if (input.currency !== before.currency && hasTransactions(id)) errors.push('currency_locked');
      if (errors.length > 0) return err(errors);
      return ok(
        withUnitOfWork(deps, ({ tx, now, audit }) => {
          const after: AccountRow = {
            ...before,
            name: input.name.trim(),
            type: input.type,
            currency: input.currency,
            openingBalanceMinor: input.openingBalanceMinor,
            openedOn: input.openedOn,
            includeInTotals: input.includeInTotals,
            icon: input.icon ?? before.icon,
            color: input.color ?? before.color,
            updatedAt: now,
            version: before.version + 1,
          };
          tx.update(accounts).set(after).where(eq(accounts.id, id)).run();
          audit({ entity: 'accounts', entityId: id, action: 'update', before, after });
          return after;
        }),
      );
    },

    /** Archive instead of delete: history must keep pointing at the account. */
    setArchived(id: string, archived: boolean): boolean {
      const before = get(id);
      if (!before || before.deletedAt !== null || before.isArchived === archived) return false;
      withUnitOfWork(deps, ({ tx, now, audit }) => {
        const after = {
          ...before,
          isArchived: archived,
          updatedAt: now,
          version: before.version + 1,
        };
        tx.update(accounts).set(after).where(eq(accounts.id, id)).run();
        audit({ entity: 'accounts', entityId: id, action: 'update', before, after });
      });
      return true;
    },
  };
}

export type AccountsRepository = ReturnType<typeof createAccountsRepository>;
