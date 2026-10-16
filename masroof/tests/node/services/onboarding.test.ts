import { createRepositories } from '@/data/repositories';
import { createOnboardingService, screenFor } from '@/services/onboarding/onboarding-service';

import { createTestDb } from '../../helpers/sqlite';

function setup() {
  const t = createTestDb();
  const repos = createRepositories({ ...t, timeZone: () => 'Africa/Khartoum' });
  const onboarding = createOnboardingService({ ...t, repos });
  return { t, repos, onboarding };
}

describe('J1 onboarding', () => {
  it('happy path: Arabic → SDG → Cash → Home', () => {
    const { repos, onboarding } = setup();
    expect(onboarding.screen()).toBe('language');
    onboarding.chooseLanguage('ar');
    expect(onboarding.screen()).toBe('currency');
    onboarding.chooseCurrency('SDG');
    expect(onboarding.screen()).toBe('account');
    const r = onboarding.createFirstAccount('الخزنة');
    expect(r.ok).toBe(true);
    expect(onboarding.screen()).toBe('done');
    expect(repos.settings.getAll()).toMatchObject({
      locale: 'ar',
      baseCurrency: 'SDG',
      onboardingStep: 'done',
    });
    expect(repos.accounts.list()).toMatchObject([
      { name: 'الخزنة', currency: 'SDG', type: 'cash' },
    ]);
    expect(repos.categories.list().length).toBeGreaterThan(5);
  });

  it('skip everything: device defaults, a Cash account, empty ledger', () => {
    const { repos, onboarding } = setup();
    onboarding.skipAll(
      { locale: 'en', baseCurrency: 'AED', firstDayOfWeek: 6, timeZone: 'Asia/Dubai' },
      'Cash',
    );
    expect(repos.settings.getAll()).toMatchObject({
      locale: 'en',
      baseCurrency: 'AED',
      firstDayOfWeek: 6,
      onboardingStep: 'done',
    });
    expect(repos.accounts.list()).toMatchObject([{ name: 'Cash', currency: 'AED' }]);
    expect(repos.reports.hasAnyTransactions()).toBe(false);
  });

  it("skip after choosing a language keeps the user's language", () => {
    const { repos, onboarding } = setup();
    onboarding.chooseLanguage('ar');
    onboarding.skipAll(
      { locale: 'en', baseCurrency: 'USD', firstDayOfWeek: 1, timeZone: 'UTC' },
      'نقد',
    );
    expect(repos.settings.get('locale')).toBe('ar');
  });

  it('killed mid-step: nothing half-created, resumes at the same step', () => {
    const { repos, onboarding } = setup();
    onboarding.chooseLanguage('en');
    onboarding.chooseCurrency('USD');
    const original = repos.settings.set;
    repos.settings.set = (key, value) => {
      if (key === 'onboardingStep') throw new Error('process killed');
      original(key, value);
    };
    expect(() => onboarding.createFirstAccount('Cash')).toThrow('process killed');
    repos.settings.set = original;
    expect(repos.accounts.list({ includeArchived: true })).toEqual([]);
    expect(repos.categories.list()).toEqual([]); // seed rolled back too
    expect(onboarding.screen()).toBe('account');
    expect(onboarding.createFirstAccount('Cash').ok).toBe(true);
    expect(repos.accounts.list()).toHaveLength(1);
  });

  it('resuming never duplicates the first account', () => {
    const { repos, onboarding } = setup();
    onboarding.createFirstAccount('Cash');
    onboarding.createFirstAccount('Cash again');
    onboarding.skipAll(
      { locale: 'en', baseCurrency: 'USD', firstDayOfWeek: 1, timeZone: 'UTC' },
      'Cash',
    );
    expect(repos.accounts.list()).toHaveLength(1);
  });

  it('rejects an invalid account name without advancing', () => {
    const { onboarding } = setup();
    onboarding.chooseLanguage('en');
    onboarding.chooseCurrency('USD');
    expect(onboarding.createFirstAccount('   ')).toEqual({ ok: false, error: ['name_empty'] });
    expect(onboarding.screen()).toBe('account');
  });

  it('optional sample data: only into an empty ledger, tagged "sample"', () => {
    const { repos, onboarding } = setup();
    onboarding.createFirstAccount('Cash');
    const r = onboarding.loadSampleData('Africa/Khartoum', { note: (k) => `sample ${k}` });
    expect(r).toEqual({ ok: true, value: 4 });
    expect(repos.names.listTags().map((t) => t.name)).toEqual(['sample']);
    expect(onboarding.loadSampleData('Africa/Khartoum', { note: (k) => k })).toEqual({
      ok: false,
      error: 'not_empty',
    });
  });

  it('maps every stored step to a screen', () => {
    expect(
      ['none', 'language', 'currency', 'account', 'security', 'done'].map((s) =>
        screenFor(s as never),
      ),
    ).toEqual(['language', 'currency', 'account', 'done', 'done', 'done']);
  });
});
