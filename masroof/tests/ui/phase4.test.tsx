import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { localDate } from '@/domain';
import { BaseCurrencyScreen } from '@/features/fx/base-currency-screen';
import { FxRatesScreen } from '@/features/fx/fx-rates-screen';
import { ReportsScreen } from '@/features/reports/reports-screen';

import { must } from '../helpers/ledger';
import { createTestSession, renderWithSession } from './ledger-session';

jest.mock('@react-native-community/datetimepicker', () => () => null);

const d = (s: string) => localDate(s);

function confirmAlerts() {
  return jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const ok = buttons?.find((b) => b.style !== 'cancel');
    ok?.onPress?.();
  });
}

describe('J10 change base currency UI', () => {
  it('✅ USD → SDG: enter a rate, preview new totals, confirm', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    must(l.repos.transactions.create(l.expense({ amountMinor: 1250 })));
    const onDone = jest.fn();
    await renderWithSession(<BaseCurrencyScreen onBackup={jest.fn()} onDone={onDone} />, ts);
    expect(screen.getByText('Current main currency: USD')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('currency-search'), 'SDG');
    await fireEvent.press(screen.getByTestId('currency-SDG'));
    await fireEvent.changeText(screen.getByTestId('rate-USD'), '600.5');
    await fireEvent.press(screen.getByTestId('base-preview'));
    expect(screen.getByTestId('base-preview-card')).toHaveTextContent(
      /Spent so far: 12\.50.USD → 7,506\.25.SDG/,
    );
    expect(screen.getByTestId('base-preview-card')).toHaveTextContent(
      /1 transactions and 0 budgets will be recalculated/,
    );
    const alert = confirmAlerts();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('base-apply'));
    });
    alert.mockRestore();
    expect(onDone).toHaveBeenCalled();
    expect(l.repos.settings.get('baseCurrency')).toBe('SDG');
  });

  it('❌ missing rate → blocked with the currency named; nothing changes', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    must(l.repos.transactions.create(l.expense()));
    await renderWithSession(<BaseCurrencyScreen onBackup={jest.fn()} onDone={jest.fn()} />, ts);
    await fireEvent.press(screen.getByTestId('currency-EUR'));
    await fireEvent.press(screen.getByTestId('base-preview'));
    expect(screen.getByTestId('base-error')).toHaveTextContent(/Enter a rate for: USD/);
    expect(screen.queryByTestId('base-apply')).toBeNull();
    expect(l.repos.settings.get('baseCurrency')).toBe('USD');
  });
});

describe('FX table UI', () => {
  it('adds a rate, refuses bad input, deletes after confirmation', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const { refresh } = await renderWithSession(<FxRatesScreen />, ts);
    await fireEvent.press(screen.getByTestId('fx-add'));
    await fireEvent.changeText(screen.getByTestId('fx-rate'), 'abc');
    await fireEvent.press(screen.getByTestId('fx-save'));
    expect(screen.getByTestId('fx-error')).toHaveTextContent(/Enter a valid rate/);
    await fireEvent.changeText(screen.getByTestId('fx-rate'), '1.085');
    await fireEvent.press(screen.getByTestId('fx-save'));
    await refresh();
    const [row] = l.repos.fx.list();
    expect(row).toMatchObject({ base: 'EUR', quote: 'USD', rate: '1.085', asOf: '2026-10-15' });
    expect(screen.getByTestId(`fx-${row?.id}`)).toHaveTextContent(/1 EUR = 1\.085 USD/);
    const alert = confirmAlerts();
    await fireEvent.press(screen.getByTestId(`fx-delete-${row?.id}`));
    alert.mockRestore();
    expect(l.repos.fx.list()).toEqual([]);
  });
});

describe('Reports UI (ADR-016)', () => {
  it('income vs expense, 12-month trend, month-over-month and top payees', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const spend = (on: string, categoryId: string, amountMinor: number, payeeName?: string) =>
      must(
        l.repos.transactions.create(
          l.expense({
            occurredOn: d(on),
            amountMinor,
            payeeName,
            splits: [{ categoryId, amountMinor }],
          }),
        ),
      );
    spend('2026-09-05', l.ids.food, 10000);
    spend('2026-10-05', l.ids.food, 12000, 'Bakery');
    spend('2026-10-06', l.ids.kids, 3000, 'Toy shop');
    must(
      l.repos.transactions.create(l.income({ amountMinor: 50000, occurredOn: d('2026-10-01') })),
    );

    await renderWithSession(<ReportsScreen />, ts);
    expect(screen.getByTestId('reports-month')).toHaveTextContent('October 2026');
    expect(screen.getByTestId('reports-net')).toHaveTextContent(/Net: 350\.00/);
    expect(screen.getByTestId('trend-2026-10-01').props.accessibilityLabel).toBe(
      'October 2026: income 500.00 USD, expense 150.00 USD',
    );
    expect(screen.getByTestId('trend-2025-11-01')).toBeOnTheScreen();
    expect(screen.getByTestId(`delta-${l.ids.food}`)).toHaveTextContent(/▲ 20\.00.*more/);
    expect(screen.getByTestId(`delta-${l.ids.kids}`)).toHaveTextContent(/▲ 30\.00.*more/);
    expect(screen.getByTestId('payees')).toHaveTextContent(/1\. Bakery.*2\. Toy shop/);

    await fireEvent.press(screen.getByTestId('reports-prev'));
    expect(screen.getByTestId('reports-month')).toHaveTextContent('September 2026');
    expect(screen.getByTestId(`delta-${l.ids.food}`)).toHaveTextContent(/▲ 100\.00.*more/);
  });

  it('empty ledger shows an empty state; Arabic renders translated', async () => {
    const ts = createTestSession({ locale: 'ar' });
    await renderWithSession(<ReportsScreen />, ts, 'ar');
    expect(screen.getByText('لا شيء مسجل في هذه الفترة.')).toBeOnTheScreen();
    expect(screen.queryByText(/reports\./)).toBeNull();
  });
});
