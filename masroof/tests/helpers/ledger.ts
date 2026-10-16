import { createRepositories, type Repositories } from '@/data/repositories';
import { localDateOf, type TransactionInput } from '@/domain';

import { createTestDb, type TestDb } from './sqlite';

export const TZ = 'Africa/Khartoum';

export type Ledger = TestDb & {
  repos: Repositories;
  ids: { cash: string; bank: string; food: string; kids: string; clothes: string; salary: string };
  /** Advance the fake clock (ms). */
  tick: (ms?: number) => void;
  expense: (over?: Partial<TransactionInput>) => TransactionInput;
  transfer: (over?: Partial<TransactionInput>) => TransactionInput;
  income: (over?: Partial<TransactionInput>) => TransactionInput;
};

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

export function createLedger(): Ledger {
  const t = createTestDb();
  const repos = createRepositories({ ...t, timeZone: () => TZ });
  repos.categories.seedDefaults();
  const bySeed = (k: string) => {
    const c = repos.categories
      .list(undefined, { includeArchived: true })
      .find((x) => x.seedKey === k);
    if (!c) throw new Error(`seed ${k} missing`);
    return c.id;
  };
  const cash = must(
    repos.accounts.create({
      name: 'Cash',
      type: 'cash',
      currency: 'USD',
      openingBalanceMinor: 5000,
      openedOn: null,
      includeInTotals: true,
    }),
  ).id;
  const bank = must(
    repos.accounts.create({
      name: 'Bank',
      type: 'bank',
      currency: 'USD',
      openingBalanceMinor: 100000,
      openedOn: null,
      includeInTotals: true,
    }),
  ).id;
  const ids = {
    cash,
    bank,
    food: bySeed('food'),
    kids: bySeed('kids'),
    clothes: bySeed('clothes'),
    salary: bySeed('salary'),
  };
  const tick = (ms = 1000) => {
    t.clock.now += ms;
  };
  const base = (): Omit<TransactionInput, 'type' | 'splits'> => ({
    accountId: cash,
    amountMinor: 1250,
    occurredAt: t.clock.now,
    occurredTz: TZ,
    occurredOn: localDateOf(t.clock.now, TZ),
  });
  return {
    ...t,
    repos,
    ids,
    tick,
    expense: (over = {}) => ({
      ...base(),
      type: 'expense',
      splits: [{ categoryId: ids.food, amountMinor: over.amountMinor ?? 1250 }],
      ...over,
    }),
    income: (over = {}) => ({
      ...base(),
      type: 'income',
      splits: [{ categoryId: ids.salary, amountMinor: over.amountMinor ?? 1250 }],
      ...over,
    }),
    transfer: (over = {}) => ({
      ...base(),
      type: 'transfer',
      accountId: bank,
      toAccountId: cash,
      amountMinor: 10000,
      splits: [],
      ...over,
    }),
  };
}

export { must };
