import { addDays, localDate, type LocalDate } from '@/domain';

import type { Ledger } from './ledger';

/**
 * Deterministic large ledger for performance work (spec Phase 5: 73k rows).
 * Written with raw SQL in one transaction so seeding takes about a second;
 * the shape mirrors what the repositories write (one split per expense or
 * income, ~10% three-way splits, transfers, payees, a few tags).
 */
export function seedLargeLedger(
  l: Ledger,
  options: { transactions?: number; endOn?: LocalDate } = {},
): { transactions: number; splits: number; firstDay: LocalDate } {
  const total = options.transactions ?? 73_000;
  const endOn = options.endOn ?? localDate('2026-10-15');
  const perDay = 10;
  const firstDay = addDays(endOn, -Math.ceil(total / perDay));
  const expenseCats = [l.ids.food, l.ids.kids, l.ids.clothes];
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  const payeeIds: string[] = [];
  let splits = 0;

  l.raw.transaction(() => {
    const now = l.clock.now;
    const insPayee = l.raw.prepare(
      `INSERT INTO payees (id, created_at, updated_at, version, name, normalized_name) VALUES (?, ?, ?, 1, ?, ?)`,
    );
    for (let i = 0; i < 200; i++) {
      const id = `payee-${i}`;
      insPayee.run(id, now, now, `Payee ${i}`, `payee ${i}`);
      payeeIds.push(id);
    }
    const insTx = l.raw.prepare(
      `INSERT INTO transactions (id, created_at, updated_at, version, type, account_id, to_account_id,
         amount_minor, currency, to_amount_minor, to_currency, fx_rate_to_base, base_amount_minor,
         occurred_at, occurred_tz, occurred_on, payee_id, note, status)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'USD', ?, ?, '1', ?, ?, 'Africa/Khartoum', ?, ?, ?, 'posted')`,
    );
    const insSplit = l.raw.prepare(
      `INSERT INTO transaction_splits (id, created_at, updated_at, version, transaction_id, category_id,
         amount_minor, base_amount_minor, sort_order) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    );
    let day = firstDay;
    for (let i = 0; i < total; i++) {
      if (i > 0 && i % perDay === 0) day = addDays(day, 1);
      const id = `seed-${String(i).padStart(6, '0')}`;
      const kind = rand(100);
      const occurredAt = Date.parse(`${day}T09:00:00Z`) + i;
      const amount = 100 + rand(50_000);
      if (kind < 4) {
        insTx.run(
          id,
          now,
          now,
          'transfer',
          l.ids.bank,
          l.ids.cash,
          amount,
          amount,
          'USD',
          amount,
          occurredAt,
          day,
          null,
          null,
        );
        continue;
      }
      const type = kind < 12 ? 'income' : 'expense';
      const note = rand(5) === 0 ? `note ${i}` : null;
      const payee = rand(3) === 0 ? null : payeeIds[rand(payeeIds.length)];
      insTx.run(
        id,
        now,
        now,
        type,
        l.ids.cash,
        null,
        amount,
        null,
        null,
        amount,
        occurredAt,
        day,
        payee,
        note,
      );
      if (type === 'income') {
        insSplit.run(`${id}-s0`, now, now, id, l.ids.salary, amount, amount, 0);
        splits++;
      } else if (rand(10) === 0 && amount >= 3) {
        const a = Math.floor(amount / 3);
        const parts = [a, a, amount - 2 * a];
        parts.forEach((p, j) =>
          insSplit.run(`${id}-s${j}`, now, now, id, expenseCats[j] as string, p, p, j),
        );
        splits += 3;
      } else {
        const cat = expenseCats[rand(expenseCats.length)] as string;
        insSplit.run(`${id}-s0`, now, now, id, cat, amount, amount, 0);
        splits++;
      }
    }
  })();
  l.sql.exec('ANALYZE');
  return { transactions: total, splits, firstDay };
}
