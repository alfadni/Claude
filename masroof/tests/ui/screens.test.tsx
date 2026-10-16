import { fireEvent, screen } from '@testing-library/react-native';

import { addDays } from '@/domain';
import { AccountFormScreen } from '@/features/accounts/account-form-screen';
import { HomeScreen, type HomeNav } from '@/features/home/home-screen';
import { OnboardingScreen } from '@/features/onboarding/onboarding-screen';
import { TransactionDetailScreen } from '@/features/transactions/detail-screen';
import { TransactionsListScreen } from '@/features/transactions/list-screen';
import { TrashScreen } from '@/features/transactions/trash-screen';
import { UndoHost } from '@/features/undo/undo-host';
import { useUndoStore } from '@/features/undo/undo-store';

import { createLedger, must } from '../helpers/ledger';
import { createTestDb } from '../helpers/sqlite';
import { createRepositories } from '@/data/repositories';
import { createTestSession, renderWithSession } from './ledger-session';

jest.mock('@react-native-community/datetimepicker', () => () => null);

const nav = (): HomeNav => ({
  onAdd: jest.fn(),
  onDay: jest.fn(),
  onCategory: jest.fn(),
  onAllTransactions: jest.fn(),
  onSettings: jest.fn(),
  onAccounts: jest.fn(),
});

describe('Home (calendar)', () => {
  it('empty ledger: empty state with "Add your first expense" (J1 skip path)', async () => {
    const ts = createTestSession();
    const n = nav();
    await renderWithSession(<HomeScreen nav={n} />, ts);
    await fireEvent.press(screen.getByRole('button', { name: 'Add your first expense' }));
    expect(n.onAdd).toHaveBeenCalled();
    expect(screen.getByTestId('month-title')).toHaveTextContent('October 2026');
  });

  it('marks days with ▲ income / ▼ expense and reads totals to screen readers', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    must(l.repos.transactions.create(l.expense({ amountMinor: 1250 })));
    must(l.repos.transactions.create(l.income({ amountMinor: 300000 })));
    await renderWithSession(<HomeScreen nav={nav()} />, ts);
    const today = l.repos.today();
    expect(screen.getByTestId(`expense-marker-${today}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`income-marker-${today}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`day-${today}`).props.accessibilityLabel).toBe(
      '15 October 2026: income 3,000.00\u00A0USD, expense 12.50\u00A0USD',
    );
    expect(screen.getByTestId('total-spent')).toHaveTextContent(/\u221212\.50/);
    expect(screen.getByTestId('category-bars')).toHaveTextContent(/Food/);
  });

  it('scheduled expenses are shown separately, not as spent', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const future = addDays(l.repos.today(), 3);
    must(
      l.repos.transactions.create(
        l.expense({ occurredOn: future, occurredAt: Date.UTC(2026, 9, 18, 9) }),
      ),
    );
    await renderWithSession(<HomeScreen nav={nav()} />, ts);
    expect(screen.getByTestId('total-spent')).toHaveTextContent(/^▼ 0\.00$/);
    expect(screen.getByTestId('scheduled-total')).toHaveTextContent(/12\.50/);
  });

  it('navigates months and opens a day', async () => {
    const ts = createTestSession();
    must(ts.ledger.repos.transactions.create(ts.ledger.expense()));
    const n = nav();
    await renderWithSession(<HomeScreen nav={n} />, ts);
    await fireEvent.press(screen.getByTestId('next-month'));
    expect(screen.getByTestId('month-title')).toHaveTextContent('November 2026');
    await fireEvent.press(screen.getByTestId('prev-month'));
    await fireEvent.press(screen.getByTestId('prev-month'));
    expect(screen.getByTestId('month-title')).toHaveTextContent('September 2026');
    await fireEvent.press(screen.getByTestId('next-month'));
    await fireEvent.press(screen.getByTestId('day-2026-10-15'));
    expect(n.onDay).toHaveBeenCalledWith('2026-10-15');
  });

  it('balance tab: transfers move money without changing income/expense (J4)', async () => {
    const ts = createTestSession();
    must(ts.ledger.repos.transactions.create(ts.ledger.transfer()));
    await renderWithSession(<HomeScreen nav={nav()} />, ts);
    await fireEvent.press(screen.getByRole('radio', { name: 'Balance' }));
    expect(screen.getByTestId('net-worth')).toHaveTextContent(/^1,050\.00/);
    expect(screen.getByTestId('total-income')).toHaveTextContent(/0\.00/);
    expect(screen.getByTestId('total-spent')).toHaveTextContent(/0\.00/);
  });

  it('renders in Arabic with Eastern Arabic digits', async () => {
    const ts = createTestSession({ locale: 'ar' });
    ts.ledger.repos.settings.set('numerals', 'arab');
    await renderWithSession(<HomeScreen nav={nav()} />, ts, 'ar');
    expect(screen.getByTestId('month-title')).toHaveTextContent('أكتوبر ٢٠٢٦');
    expect(screen.getByText('لا توجد معاملات بعد')).toBeOnTheScreen();
  });
});

describe('Transaction detail: J7 delete → undo', () => {
  beforeEach(() => useUndoStore.getState().dismiss());

  it('delete shows an undo snackbar; Undo restores exactly', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const { id } = must(
      l.repos.transactions.create(
        l.expense({
          amountMinor: 12300,
          note: 'Eid',
          tagNames: ['eid'],
          splits: [
            { categoryId: l.ids.clothes, amountMinor: 8000 },
            { categoryId: l.ids.kids, amountMinor: 4300 },
          ],
        }),
      ),
    );
    const before = l.repos.transactions.get(id);
    const onDeleted = jest.fn();
    await renderWithSession(
      <>
        <TransactionDetailScreen id={id} onEdit={jest.fn()} onDeleted={onDeleted} />
        <UndoHost />
      </>,
      ts,
    );
    expect(screen.getByTestId('detail-amount')).toHaveTextContent(/\u2212123\.00/);
    l.tick();
    await fireEvent.press(screen.getByTestId('delete'));
    expect(onDeleted).toHaveBeenCalled();
    expect(l.repos.transactions.get(id)?.deletedAt).not.toBeNull();
    expect(screen.getByTestId('snackbar')).toHaveTextContent(/Transaction deleted/);
    l.tick();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    const after = l.repos.transactions.get(id);
    expect(after?.deletedAt).toBeNull();
    expect(after?.splits.map((s) => [s.categoryId, s.amountMinor])).toEqual(
      before?.splits.map((s) => [s.categoryId, s.amountMinor]),
    );
    expect(after?.tags).toEqual(before?.tags);
  });

  it('a missing transaction shows a clear empty state', async () => {
    await renderWithSession(
      <TransactionDetailScreen id="nope" onEdit={jest.fn()} onDeleted={jest.fn()} />,
      createTestSession(),
    );
    expect(screen.getByText('This transaction no longer exists')).toBeOnTheScreen();
  });
});

describe('Trash (J7 undo window missed)', () => {
  it('lists deleted items and restores them', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const { id } = must(l.repos.transactions.create(l.expense({ note: 'gone' })));
    l.tick();
    must(l.repos.transactions.delete(id));
    const utils = await renderWithSession(<TrashScreen />, ts);
    expect(screen.getByTestId(`tx-${id}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`restore-${id}`));
    expect(l.repos.transactions.get(id)?.deletedAt).toBeNull();
    await utils.refresh();
    expect(screen.queryByTestId(`tx-${id}`)).toBeNull();
    expect(screen.getByText('Trash is empty')).toBeOnTheScreen();
  });
});

describe('Transactions list', () => {
  it('searches by note and by amount; clear filters', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    must(
      l.repos.transactions.create(
        l.expense({
          note: 'coffee',
          amountMinor: 450,
          splits: [{ categoryId: l.ids.food, amountMinor: 450 }],
        }),
      ),
    );
    l.tick();
    must(
      l.repos.transactions.create(
        l.expense({
          note: 'rent',
          amountMinor: 50000,
          splits: [{ categoryId: l.ids.food, amountMinor: 50000 }],
        }),
      ),
    );
    await renderWithSession(<TransactionsListScreen params={{}} onOpen={jest.fn()} />, ts);
    expect(screen.getAllByText(/coffee|rent/)).toHaveLength(2);
    await fireEvent.changeText(screen.getByTestId('search'), 'coff');
    expect(screen.queryByText(/rent/)).toBeNull();
    await fireEvent.changeText(screen.getByTestId('search'), '500');
    expect(screen.getByText(/rent/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('search'), 'zzz');
    expect(screen.getByText('Nothing found')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByText(/coffee|rent/)).toHaveLength(2);
  });

  it('filters by type and opens a row', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const { id } = must(l.repos.transactions.create(l.income({ note: 'salary' })));
    must(l.repos.transactions.create(l.expense({ note: 'lunch' })));
    const onOpen = jest.fn();
    await renderWithSession(<TransactionsListScreen params={{}} onOpen={onOpen} />, ts);
    await fireEvent.press(screen.getByRole('radio', { name: 'Income' }));
    expect(screen.queryByText(/lunch/)).toBeNull();
    await fireEvent.press(screen.getByTestId(`tx-${id}`));
    expect(onOpen).toHaveBeenCalledWith(id);
  });
});

describe('Onboarding (J1)', () => {
  function fresh() {
    const t = createTestDb();
    const repos = createRepositories({ ...t, timeZone: () => 'Africa/Khartoum' });
    const ledger = { ...createLedger(), ...t, repos };
    return createTestSession({ ledger: ledger as never });
  }
  const device = {
    locale: 'en',
    baseCurrency: 'SDG',
    firstDayOfWeek: 6,
    timeZone: 'Africa/Khartoum',
  } as const;

  it('language → currency → account → done', async () => {
    const ts = fresh();
    const onLang = jest.fn();
    const onFinished = jest.fn();
    const utils = await renderWithSession(
      <OnboardingScreen device={device} onLanguageChosen={onLang} onFinished={onFinished} />,
      ts,
    );
    expect(screen.getByTestId('onboarding-language')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('lang-ar'));
    expect(onLang).toHaveBeenCalledWith('ar');
    await utils.refresh();
    expect(screen.getByTestId('onboarding-currency')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('currency-SDG'));
    await fireEvent.press(screen.getByTestId('currency-continue'));
    await utils.refresh();
    expect(screen.getByTestId('onboarding-account')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('onboarding-start'));
    expect(onFinished).toHaveBeenCalled();
    expect(ts.session.repos.accounts.list()).toMatchObject([{ name: 'Cash', currency: 'SDG' }]);
    expect(ts.session.onboarding.screen()).toBe('done');
  });

  it('skip everything applies device defaults', async () => {
    const ts = fresh();
    const onFinished = jest.fn();
    await renderWithSession(
      <OnboardingScreen device={device} onLanguageChosen={jest.fn()} onFinished={onFinished} />,
      ts,
    );
    await fireEvent.press(screen.getByTestId('skip-all'));
    expect(onFinished).toHaveBeenCalled();
    expect(ts.session.repos.settings.getAll()).toMatchObject({
      baseCurrency: 'SDG',
      firstDayOfWeek: 6,
      onboardingStep: 'done',
    });
  });

  it('resumes at the step after the last completed one', async () => {
    const ts = fresh();
    ts.session.onboarding.chooseLanguage('en');
    await renderWithSession(
      <OnboardingScreen device={device} onLanguageChosen={jest.fn()} onFinished={jest.fn()} />,
      ts,
    );
    expect(screen.getByTestId('onboarding-currency')).toBeOnTheScreen();
  });
});

describe('Account form', () => {
  it('creates an account; rejects an empty name', async () => {
    const ts = createTestSession();
    const onDone = jest.fn();
    await renderWithSession(<AccountFormScreen id={null} onDone={onDone} />, ts);
    await fireEvent.press(screen.getByTestId('account-save'));
    expect(screen.getByText('Enter a name')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('account-name'), 'Bankak');
    await fireEvent.press(screen.getByRole('radio', { name: 'Mobile wallet' }));
    await fireEvent.press(screen.getByTestId('currency-SDG'));
    await fireEvent.changeText(screen.getByTestId('account-opening'), '-50');
    await fireEvent.press(screen.getByTestId('account-save'));
    expect(onDone).toHaveBeenCalled();
    expect(ts.session.repos.accounts.list().find((a) => a.name === 'Bankak')).toMatchObject({
      type: 'mobile_wallet',
      currency: 'SDG',
      openingBalanceMinor: -5000,
    });
  });

  it('locks currency once the account has transactions', async () => {
    const ts = createTestSession();
    must(ts.ledger.repos.transactions.create(ts.ledger.expense()));
    await renderWithSession(<AccountFormScreen id={ts.ledger.ids.cash} onDone={jest.fn()} />, ts);
    expect(
      screen.getByText(/Currency cannot change once the account has transactions/),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('currency-search')).toBeNull();
  });
});
