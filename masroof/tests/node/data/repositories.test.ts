import { withUnitOfWork } from '@/data/unit-of-work';
import { SEED_CATEGORIES } from '@/domain';

import { createLedger, must } from '../../helpers/ledger';

describe('accounts repository', () => {
  it('lists active accounts; archived ones only on request', () => {
    const l = createLedger();
    l.repos.accounts.setArchived(l.ids.bank, true);
    expect(l.repos.accounts.list().map((a) => a.name)).toEqual(['Cash']);
    expect(l.repos.accounts.list({ includeArchived: true })).toHaveLength(2);
    expect(l.repos.accounts.setArchived(l.ids.bank, true)).toBe(false); // no-op
    expect(l.repos.accounts.setArchived('nope', true)).toBe(false);
  });

  it('rejects invalid input', () => {
    const l = createLedger();
    const r = l.repos.accounts.create({
      name: ' ',
      type: 'cash',
      currency: 'USD',
      openingBalanceMinor: 0,
      openedOn: null,
      includeInTotals: true,
    });
    expect(r).toEqual({ ok: false, error: ['name_empty'] });
  });

  it('locks the currency once the account has transactions (no silent relabel, G5)', () => {
    const l = createLedger();
    const input = {
      name: 'Cash',
      type: 'cash',
      currency: 'SDG',
      openingBalanceMinor: 5000,
      openedOn: null,
      includeInTotals: true,
    } as const;
    expect(must(l.repos.accounts.update(l.ids.cash, input)).currency).toBe('SDG');
    must(l.repos.accounts.update(l.ids.cash, { ...input, currency: 'USD' }));
    must(l.repos.transactions.create(l.expense()));
    expect(l.repos.accounts.update(l.ids.cash, input)).toEqual({
      ok: false,
      error: ['currency_locked'],
    });
    expect(
      must(l.repos.accounts.update(l.ids.cash, { ...input, currency: 'USD', name: 'Wallet' })).name,
    ).toBe('Wallet');
    expect(l.repos.accounts.update('nope', input)).toEqual({ ok: false, error: ['not_found'] });
  });

  it('excludes accounts not in totals from net worth', () => {
    const l = createLedger();
    const bank = l.repos.accounts.get(l.ids.bank);
    if (!bank) throw new Error();
    must(
      l.repos.accounts.update(l.ids.bank, {
        name: bank.name,
        type: 'bank',
        currency: 'USD',
        openingBalanceMinor: 100000,
        openedOn: null,
        includeInTotals: false,
      }),
    );
    expect(l.repos.reports.netWorth(l.repos.today()).totalMinor).toBe(5000);
  });
});

describe('categories repository', () => {
  it('seeds once (idempotent)', () => {
    const l = createLedger();
    expect(l.repos.categories.seedDefaults()).toBe(0);
    expect(l.repos.categories.list(undefined, { includeArchived: true })).toHaveLength(
      SEED_CATEGORIES.length,
    );
  });

  it('creates, renames, archives and reorders; never hard-deletes', () => {
    const l = createLedger();
    const c = must(l.repos.categories.create({ name: ' Rent ', kind: 'expense' }));
    expect(c.name).toBe('Rent');
    expect(l.repos.categories.create({ name: '', kind: 'expense' })).toEqual({
      ok: false,
      error: 'name_empty',
    });
    expect(must(l.repos.categories.rename(c.id, 'House rent')).name).toBe('House rent');
    expect(l.repos.categories.rename('nope', 'x')).toEqual({ ok: false, error: 'not_found' });
    expect(l.repos.categories.setArchived(c.id, true)).toBe(true);
    expect(l.repos.categories.list('expense').map((x) => x.id)).not.toContain(c.id);
    expect(
      l.repos.categories.list('expense', { includeArchived: true }).map((x) => x.id),
    ).toContain(c.id);

    const ids = l.repos.categories
      .list('income')
      .map((x) => x.id)
      .reverse();
    l.repos.categories.reorder('income', ids);
    expect(l.repos.categories.list('income').map((x) => x.id)).toEqual(ids);
  });
});

describe('drafts repository (J2: backgrounded mid-entry)', () => {
  it('keeps a draft for 10 minutes, then discards it', () => {
    const l = createLedger();
    l.repos.drafts.save('quick-add', { amount: '12+8' });
    l.tick(9 * 60_000);
    expect(l.repos.drafts.load('quick-add')).toEqual({ amount: '12+8' });
    l.tick(2 * 60_000);
    expect(l.repos.drafts.load('quick-add')).toBeNull();
    expect(l.sql.all('SELECT * FROM drafts')).toEqual([]);
  });

  it('clear removes it; unknown keys are null', () => {
    const l = createLedger();
    l.repos.drafts.save('k', { a: 1 });
    l.repos.drafts.clear('k');
    expect(l.repos.drafts.load('k')).toBeNull();
  });
});

describe('attachments repository', () => {
  it('caps attachments at 5 per transaction', () => {
    const l = createLedger();
    const { id } = must(l.repos.transactions.create(l.expense()));
    const add = (n: number) =>
      l.repos.attachments.insert({
        id: `a${n}`,
        transactionId: id,
        filePath: `attachments/a${n}.bin`,
        mime: 'image/jpeg',
        sizeBytes: 100,
        sha256: 'b'.repeat(64),
      });
    for (let i = 0; i < 5; i++) expect(add(i)).toBe('ok');
    expect(add(5)).toBe('limit_reached');
    expect(l.repos.attachments.totalBytes()).toBe(500);
    expect(l.repos.attachments.remove('a0')).toBe(true);
    expect(l.repos.attachments.remove('a0')).toBe(false);
    expect(add(6)).toBe('ok');
    expect(
      l.repos.attachments.insert({
        id: 'x',
        transactionId: 'missing',
        filePath: 'p',
        mime: 'image/jpeg',
        sizeBytes: 1,
        sha256: 'c'.repeat(64),
      }),
    ).toBe('not_found');
    expect(l.repos.attachments.referencedPaths().has('attachments/a0.bin')).toBe(true); // soft-deleted file still referenced
  });
});

describe('re-entrant unit of work', () => {
  it('nested repository writes join the outer transaction and roll back together', () => {
    const l = createLedger();
    expect(() =>
      withUnitOfWork(l, () => {
        must(
          l.repos.accounts.create({
            name: 'Temp',
            type: 'cash',
            currency: 'USD',
            openingBalanceMinor: 0,
            openedOn: null,
            includeInTotals: true,
          }),
        );
        l.repos.settings.set('theme', 'dark');
        throw new Error('crash mid-step');
      }),
    ).toThrow('crash mid-step');
    expect(l.repos.accounts.list().map((a) => a.name)).toEqual(['Cash', 'Bank']);
    expect(l.repos.settings.get('theme')).toBe('system');
  });
});
