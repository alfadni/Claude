import { DEFAULT_SETTINGS, isSettingKey, SETTING_VALIDATORS } from '@/domain/settings';

describe('settings validators', () => {
  it('accept every default', () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      expect([key, SETTING_VALIDATORS[key as keyof typeof DEFAULT_SETTINGS](value)]).toEqual([
        key,
        true,
      ]);
    }
  });

  it.each([
    ['locale', 'fr'],
    ['locale', null],
    ['baseCurrency', 'usd'],
    ['baseCurrency', 840],
    ['firstDayOfWeek', 7],
    ['firstDayOfWeek', '1'],
    ['numberFormat', 'indian'],
    ['numberFormat', 3],
    ['numerals', 'roman'],
    ['theme', 'sepia'],
    ['lockTimeoutSeconds', -1],
    ['lockTimeoutSeconds', 3601],
    ['lockTimeoutSeconds', 1.5],
    ['lockTimeoutSeconds', '60'],
    ['onboardingStep', 'halfway'],
  ] as const)('reject %s = %p', (key, value) => {
    expect(SETTING_VALIDATORS[key](value)).toBe(false);
  });

  it('recognises keys', () => {
    expect(isSettingKey('locale')).toBe(true);
    expect(isSettingKey('legacy')).toBe(false);
  });
});
