import type { Repositories } from '@/data/repositories';
import { withUnitOfWork } from '@/data/unit-of-work';
import type { DataDeps } from '@/data/database';
import {
  addDays,
  err,
  localDateOf,
  ok,
  type AccountError,
  type AccountType,
  type CurrencyCode,
  type Result,
} from '@/domain';
import type { Locale, Settings } from '@/domain/settings';

import type { DeviceDefaults } from '../locale/device-defaults';

/**
 * Onboarding (J1): language → base currency → first account → done.
 * App lock (PIN + biometrics) joins as a 'security' step in Phase 2.
 *
 * Each step commits its data AND the step marker in one unit of work, so an app
 * killed mid-onboarding resumes at the next step with nothing half-created.
 */
export type OnboardingScreen = 'language' | 'currency' | 'account' | 'done';

export function screenFor(step: Settings['onboardingStep']): OnboardingScreen {
  switch (step) {
    case 'none':
      return 'language';
    case 'language':
      return 'currency';
    case 'currency':
      return 'account';
    case 'account':
    case 'security':
    case 'done':
      return 'done';
  }
}

export function createOnboardingService(deps: DataDeps & { repos: Repositories }) {
  const { repos } = deps;
  const step = () => repos.settings.get('onboardingStep');

  function ensureFirstAccount(name: string, type: AccountType): Result<string, AccountError[]> {
    const existing = repos.accounts.list({ includeArchived: true })[0];
    if (existing) return ok(existing.id); // resumed: never duplicate
    const r = repos.accounts.create({
      name,
      type,
      currency: repos.settings.get('baseCurrency'),
      openingBalanceMinor: 0,
      openedOn: null,
      includeInTotals: true,
    });
    return r.ok ? ok(r.value.id) : r;
  }

  return {
    screen: (): OnboardingScreen => screenFor(step()),

    chooseLanguage(locale: Locale): void {
      withUnitOfWork(deps, () => {
        repos.settings.set('locale', locale);
        repos.settings.set('onboardingStep', 'language');
      });
    },

    chooseCurrency(currency: CurrencyCode): void {
      withUnitOfWork(deps, () => {
        repos.settings.set('baseCurrency', currency);
        repos.settings.set('onboardingStep', 'currency');
      });
    },

    /** Seeds categories, creates the first account, completes onboarding. */
    createFirstAccount(name: string, type: AccountType = 'cash'): Result<string, AccountError[]> {
      return withUnitOfWork(deps, () => {
        repos.categories.seedDefaults();
        const r = ensureFirstAccount(name, type);
        if (!r.ok) return r;
        repos.settings.set('onboardingStep', 'done');
        return r;
      });
    },

    /** "Skip everything" (J1): device defaults, a "Cash" account, empty Home. */
    skipAll(defaults: DeviceDefaults, cashName: string): string {
      return withUnitOfWork(deps, () => {
        const current = step();
        if (current === 'none') repos.settings.set('locale', defaults.locale);
        if (current === 'none' || current === 'language') {
          repos.settings.set('baseCurrency', defaults.baseCurrency);
          repos.settings.set('firstDayOfWeek', defaults.firstDayOfWeek);
        }
        repos.categories.seedDefaults();
        const r = ensureFirstAccount(cashName, 'cash');
        if (!r.ok) throw new Error('default account rejected'); // cashName comes from i18n, never user input
        repos.settings.set('onboardingStep', 'done');
        return r.value;
      });
    },

    /**
     * Optional sample data, tagged "sample" so it can be found and deleted.
     * Only allowed while the ledger is empty, so it never mixes with real data.
     */
    loadSampleData(
      timeZone: string,
      labels: { note: (k: string) => string },
    ): Result<number, 'not_empty'> {
      if (repos.reports.hasAnyTransactions()) return err('not_empty');
      const accountId = repos.accounts.list()[0]?.id;
      if (!accountId) return err('not_empty');
      const today = localDateOf(deps.now(), timeZone);
      const bySeed = new Map(repos.categories.list().map((c) => [c.seedKey, c.id]));
      // [seed category, type, minor units, days before today]
      const samples: [string, 'expense' | 'income', number, number][] = [
        ['salary', 'income', 300000, -10],
        ['food', 'expense', 4500, -3],
        ['fuel', 'expense', 12000, -2],
        ['bills', 'expense', 8000, -1],
      ];
      let created = 0;
      withUnitOfWork(deps, () => {
        for (const [seed, type, minor, offset] of samples) {
          const categoryId = bySeed.get(seed);
          if (!categoryId) continue;
          const on = addDays(today, offset);
          const r = repos.transactions.create({
            type,
            accountId,
            amountMinor: minor,
            occurredAt: deps.now() + offset * 86_400_000,
            occurredTz: timeZone,
            occurredOn: on,
            note: labels.note(seed),
            tagNames: ['sample'],
            splits: [{ categoryId, amountMinor: minor }],
          });
          if (r.ok) created++;
        }
      });
      return ok(created);
    },
  };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
