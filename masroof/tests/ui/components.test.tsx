import { fireEvent, screen } from '@testing-library/react-native';

import { money } from '@/domain';
import { BootErrorScreen } from '@/features/boot/boot-error-screen';
import type { BootErrorKind } from '@/features/boot/boot-store';
import { SettingsScreen } from '@/features/settings/settings-screen';
import { DEFAULT_SETTINGS } from '@/domain/settings';
import { AmountText, Button, palettes, resolveScheme, Text } from '@/ui';

import { renderWithProviders } from './render';

describe('AmountText', () => {
  const spoken = (kind: string) => (s: string) => `${kind} ${s}`;

  it('never relies on colour alone: shows sign and glyph', async () => {
    await renderWithProviders(
      <>
        <AmountText
          testID="exp"
          money={money(1250, 'USD')}
          kind="expense"
          spokenLabel={spoken('Expense')}
        />
        <AmountText
          testID="inc"
          money={money(1250, 'USD')}
          kind="income"
          spokenLabel={spoken('Income')}
        />
      </>,
    );
    expect(screen.getByTestId('exp')).toHaveTextContent('▼ \u221212.50\u00A0USD');
    expect(screen.getByTestId('inc')).toHaveTextContent('▲ +12.50\u00A0USD');
  });

  it('gives screen readers a sentence, not glyphs', async () => {
    await renderWithProviders(
      <AmountText
        testID="a"
        money={money(1250, 'USD')}
        kind="expense"
        spokenLabel={spoken('Expense')}
      />,
    );
    expect(screen.getByTestId('a').props.accessibilityLabel).toBe('Expense 12.50\u00A0USD');
  });

  it('renders Eastern Arabic numerals when asked', async () => {
    await renderWithProviders(
      <AmountText
        testID="a"
        money={money(1250, 'SDG')}
        kind="neutral"
        format={{ numerals: 'arab', currencyDisplay: 'none' }}
        spokenLabel={spoken('')}
      />,
    );
    expect(screen.getByTestId('a')).toHaveTextContent('١٢\u066B٥٠');
  });

  it('uses expense colour from the theme', async () => {
    await renderWithProviders(
      <AmountText testID="a" money={money(1, 'USD')} kind="expense" spokenLabel={spoken('')} />,
      {
        theme: 'dark',
      },
    );
    expect(screen.getByTestId('a')).toHaveStyle({ color: palettes.dark.expense });
  });
});

describe('Text and Button', () => {
  it('keeps font scaling on and aligns with writing direction', async () => {
    await renderWithProviders(<Text testID="t">hello</Text>);
    const t = screen.getByTestId('t');
    expect(t.props.allowFontScaling).toBe(true);
    expect(t).toHaveStyle({ textAlign: 'auto' });
  });

  it('exposes role, label and disabled state; blocks presses when disabled', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button label="Save" disabled onPress={onPress} />);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toBeDisabled();
    await fireEvent.press(b);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('meets the 48pt minimum touch target', async () => {
    await renderWithProviders(<Button label="Go" onPress={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveStyle({ minHeight: 48 });
  });
});

describe('theme resolution', () => {
  it.each([
    ['light', 'dark', 'light'],
    ['dark', 'light', 'dark'],
    ['system', 'dark', 'dark'],
    ['system', 'light', 'light'],
    ['system', null, 'light'],
  ] as const)('pref %s + system %s → %s', async (pref, sys, expected) => {
    expect(resolveScheme(pref, sys)).toBe(expected);
  });
});

describe('BootErrorScreen', () => {
  const kinds: BootErrorKind[] = [
    'cipher_unavailable',
    'key_lost',
    'undecryptable',
    'secure_store_failed',
    'newer_schema',
    'unexpected',
  ];

  it.each(kinds)('%s: explains the problem as an alert and offers retry', async (kind) => {
    const onRetry = jest.fn();
    const { i18n } = await renderWithProviders(<BootErrorScreen kind={kind} onRetry={onRetry} />);
    expect(screen.getByText(i18n.t(`boot.${kind}.title`))).toBeOnTheScreen();
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: i18n.t('common.retry') }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('data-loss states reassure the user nothing was deleted', async () => {
    const { i18n } = await renderWithProviders(
      <BootErrorScreen kind="key_lost" onRetry={() => undefined} />,
    );
    expect(i18n.t('boot.key_lost.body')).toMatch(/not been deleted/);
  });

  it('renders in Arabic', async () => {
    await renderWithProviders(<BootErrorScreen kind="newer_schema" onRetry={() => undefined} />, {
      locale: 'ar',
    });
    expect(screen.getByText('يلزم التحديث')).toBeOnTheScreen();
  });
});

describe('SettingsScreen', () => {
  async function setup(restartRequired = false) {
    const onChange = jest.fn();
    const onRestart = jest.fn();
    const utils = await renderWithProviders(
      <SettingsScreen
        settings={DEFAULT_SETTINGS}
        restartRequired={restartRequired}
        onChange={onChange}
        onRestart={onRestart}
        t={((k: string) => k) as never}
      />,
    );
    return { onChange, onRestart, ...utils };
  }

  it('switches language, theme and numerals', async () => {
    const { onChange } = await setup();
    await fireEvent.press(screen.getByRole('radio', { name: 'languages.ar' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'settings.themeDark' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'settings.numeralsArab' }));
    expect(onChange.mock.calls).toEqual([
      ['locale', 'ar'],
      ['theme', 'dark'],
      ['numerals', 'arab'],
    ]);
  });

  it('marks the current choice as checked', async () => {
    await setup();
    expect(screen.getByRole('radio', { name: 'languages.en' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'languages.ar' })).not.toBeChecked();
  });

  it('offers a restart only when the layout direction must flip', async () => {
    await setup(false);
    expect(screen.queryByText('settings.restartTitle')).toBeNull();
  });

  it('restart prompt calls back', async () => {
    const { onRestart } = await setup(true);
    await fireEvent.press(screen.getByRole('button', { name: 'settings.restartNow' }));
    expect(onRestart).toHaveBeenCalled();
  });
});
