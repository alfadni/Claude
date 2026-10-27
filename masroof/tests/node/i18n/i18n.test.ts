import { createI18n, isRtlLocale, resolveLocale } from '@/i18n';
import { ar } from '@/i18n/locales/ar';
import { en } from '@/i18n/locales/en';
import { deviceDefaults } from '@/services/locale/device-defaults';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});
}

const placeholders = (s: string) => (s.match(/{{\s*\w+\s*}}/g) ?? []).sort();

describe('translations', () => {
  const flatEn = flatten(en);
  const flatAr = flatten(ar);

  it('Arabic has exactly the English keys', () => {
    expect(Object.keys(flatAr).sort()).toEqual(Object.keys(flatEn).sort());
  });

  it('no empty strings', () => {
    for (const [k, v] of [...Object.entries(flatEn), ...Object.entries(flatAr)]) {
      expect([k, v.trim().length > 0]).toEqual([k, true]);
    }
  });

  it('interpolation placeholders match across languages', () => {
    for (const key of Object.keys(flatEn)) {
      expect([key, placeholders(flatAr[key] ?? '')]).toEqual([
        key,
        placeholders(flatEn[key] ?? ''),
      ]);
    }
  });

  it('Arabic strings are actually Arabic (no untranslated copies)', () => {
    const allowedSame = new Set(['languages.en', 'languages.ar']);
    for (const key of Object.keys(flatEn)) {
      if (allowedSame.has(key)) continue;
      expect([key, flatAr[key] === flatEn[key]]).toEqual([key, false]);
    }
  });

  it('initialises synchronously and interpolates', () => {
    const i18n = createI18n('ar');
    expect(i18n.t('home.addFirst')).toBe('أضف أول مصروف');
    expect(i18n.t('amount.expense', { amount: '5.00 USD' })).toBe('مصروف 5.00 USD');
    expect(createI18n('en').t('home.addFirst')).toBe('Add your first expense');
  });
});

describe('locale resolution', () => {
  it.each([
    ['ar', 'ar'],
    ['ar-SD', 'ar'],
    ['AR_sa', 'ar'],
    ['en-GB', 'en'],
    ['fr-FR', 'en'],
    ['', 'en'],
    [null, 'en'],
  ])('%p → %s', (tag, expected) => {
    expect(resolveLocale(tag)).toBe(expected);
  });

  it('knows Arabic is RTL', () => {
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('en')).toBe(false);
  });
});

describe('device defaults (J1: user skips onboarding)', () => {
  it('uses what the OS reports', () => {
    expect(
      deviceDefaults({
        languageTag: 'ar-SD',
        currencyCode: 'SDG',
        firstWeekday: 7,
        timeZone: 'Africa/Khartoum',
      }),
    ).toEqual({
      locale: 'ar',
      baseCurrency: 'SDG',
      firstDayOfWeek: 6,
      timeZone: 'Africa/Khartoum',
    });
    expect(deviceDefaults({ firstWeekday: 1 }).firstDayOfWeek).toBe(0);
    expect(deviceDefaults({ currencyCode: 'eur' }).baseCurrency).toBe('EUR');
  });

  it('falls back safely when the OS reports nothing or garbage', () => {
    expect(deviceDefaults({})).toEqual({
      locale: 'en',
      baseCurrency: 'USD',
      firstDayOfWeek: 1,
      timeZone: 'UTC',
    });
    expect(
      deviceDefaults({
        languageTag: 'xx',
        currencyCode: 'XYZ',
        firstWeekday: 9,
        timeZone: 'Mars/Base',
      }),
    ).toEqual({ locale: 'en', baseCurrency: 'USD', firstDayOfWeek: 1, timeZone: 'UTC' });
    expect(deviceDefaults({ firstWeekday: 2.5 }).firstDayOfWeek).toBe(1);
  });
});
