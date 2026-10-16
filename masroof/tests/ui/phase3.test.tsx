import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { localDate } from '@/domain';
import { BudgetFormScreen } from '@/features/budgets/budget-form-screen';
import { BudgetsScreen } from '@/features/budgets/budgets-screen';
import { CategoriesScreen } from '@/features/categories/categories-screen';
import { GoalFormScreen } from '@/features/goals/goal-form-screen';
import { GoalsScreen } from '@/features/goals/goals-screen';
import { HomeScreen, type HomeNav } from '@/features/home/home-screen';
import { RecurringFormScreen } from '@/features/planning/recurring-form-screen';
import { RecurringListScreen } from '@/features/planning/recurring-list-screen';
import { UpcomingScreen } from '@/features/planning/upcoming-screen';
import { TransactionDetailScreen } from '@/features/transactions/detail-screen';
import { runRecurrenceEngine } from '@/services/planning/recurrence-engine';

import { must, type Ledger } from '../helpers/ledger';
import { setDay } from '../helpers/planning';
import { createTestSession, renderWithSession, type TestSession } from './ledger-session';

jest.mock('@react-native-community/datetimepicker', () => () => null);

const d = (s: string) => localDate(s);

function rent(l: Ledger, mode: 'auto_post' | 'confirm_before_post' | 'remind_only') {
  const tx = must(
    l.repos.transactions.create(
      l.expense({
        occurredOn: d('2026-10-01'),
        accountId: l.ids.bank,
        amountMinor: 50000,
        splits: [{ categoryId: l.ids.food, amountMinor: 50000 }],
        payeeName: 'Landlord',
      }),
    ),
  );
  const rule = must(
    l.repos.recurring.createFromTransaction(tx.id, {
      pattern: { frequency: 'monthly', interval: 1, byMonthDay: 1 },
      mode,
    }),
  );
  return { txId: tx.id, ruleId: rule.id };
}

const run = (l: Ledger) => runRecurrenceEngine({ ...l, repos: l.repos }, l.repos.today());

const homeNav = (): HomeNav => ({
  onAdd: jest.fn(),
  onDay: jest.fn(),
  onCategory: jest.fn(),
  onAllTransactions: jest.fn(),
  onSettings: jest.fn(),
  onAccounts: jest.fn(),
  onUpcoming: jest.fn(),
  onBudgets: jest.fn(),
});

async function upcoming(ts: TestSession) {
  const onOpenRule = jest.fn();
  const utils = await renderWithSession(
    <UpcomingScreen onOpenRule={onOpenRule} onManageRules={jest.fn()} />,
    ts,
  );
  return { ...utils, onOpenRule };
}

describe('J5 Upcoming inbox', () => {
  it('✅ confirm_before_post: confirm posts it', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    rent(l, 'confirm_before_post');
    setDay(l, '2026-11-02');
    run(l);
    const [p] = l.repos.transactions.listPending();
    const { refresh } = await upcoming(ts);
    expect(screen.getByTestId(`pending-${p?.id}`)).toHaveTextContent(/Landlord/);
    expect(screen.getByTestId(`pending-${p?.id}`)).toHaveTextContent(/Due 1 November 2026/);
    await fireEvent.press(screen.getByTestId(`confirm-${p?.id}`));
    expect(l.repos.transactions.get(p?.id as string)?.status).toBe('posted');
    await refresh();
    expect(screen.queryByTestId(`pending-${p?.id}`)).toBeNull();
    expect(screen.getByText(/Nothing waiting/)).toBeOnTheScreen();
  });

  it('✅ edit the amount before confirming; invalid amount is refused', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    rent(l, 'confirm_before_post');
    setDay(l, '2026-11-02');
    run(l);
    const [p] = l.repos.transactions.listPending();
    await upcoming(ts);
    await fireEvent.press(screen.getByTestId(`edit-${p?.id}`));
    await fireEvent.changeText(screen.getByTestId(`amount-${p?.id}`), 'abc');
    await fireEvent.press(screen.getByTestId(`save-amount-${p?.id}`));
    expect(screen.getByTestId('upcoming-error')).toHaveTextContent(/valid amount/);
    expect(l.repos.transactions.get(p?.id as string)?.status).toBe('pending_recurring');
    await fireEvent.changeText(screen.getByTestId(`amount-${p?.id}`), '525.75');
    await fireEvent.press(screen.getByTestId(`save-amount-${p?.id}`));
    expect(l.repos.transactions.get(p?.id as string)).toMatchObject({
      status: 'posted',
      amountMinor: 52575,
    });
  });

  it('✅ skip voids it; remind_only offers Record / Dismiss', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    rent(l, 'remind_only');
    setDay(l, '2026-11-02');
    run(l);
    const [p] = l.repos.transactions.listPending();
    await upcoming(ts);
    expect(screen.getByTestId(`confirm-${p?.id}`)).toHaveTextContent('Record it');
    await fireEvent.press(screen.getByTestId(`skip-${p?.id}`));
    expect(screen.getByTestId(`skip-${p?.id}`)).toHaveTextContent('Dismiss');
    expect(l.repos.transactions.get(p?.id as string)?.status).toBe('void');
  });

  it('❌ back-fill > 3: review card posts all at once', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const { ruleId } = rent(l, 'auto_post');
    setDay(l, '2027-02-10');
    run(l);
    await upcoming(ts);
    expect(screen.getByTestId(`review-${ruleId}`)).toHaveTextContent(
      /4 occurrences of “Landlord” were not recorded automatically/,
    );
    await fireEvent.press(screen.getByTestId(`post-all-${ruleId}`));
    expect(l.repos.transactions.listPending()).toEqual([]);
    expect(l.repos.transactions.list({}, null)).toHaveLength(5);
  });

  it('❌ notifications denied: banner explains and links to Settings', async () => {
    const ts = createTestSession({ permission: 'denied' });
    await upcoming(ts);
    expect(screen.getByTestId('notifications-off')).toHaveTextContent(/only appear inside Masroof/);
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(ts.openSettings).toHaveBeenCalled();
  });

  it('a rule that cannot post is shown with its reason and a way to fix it', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const { ruleId } = rent(l, 'auto_post');
    l.repos.categories.setArchived(l.ids.food, true);
    setDay(l, '2026-11-02');
    run(l);
    const { onOpenRule } = await upcoming(ts);
    expect(screen.getByTestId(`rule-error-${ruleId}`)).toHaveTextContent(
      /“Landlord” could not be recorded: This category is archived/,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Open rule' }));
    expect(onOpenRule).toHaveBeenCalledWith(ruleId);
  });

  it('coming up lists the next 30 days', async () => {
    const ts = createTestSession();
    rent(ts.ledger, 'auto_post');
    await upcoming(ts);
    expect(screen.getByText('1 November 2026')).toBeOnTheScreen();
  });
});

describe('J5 rule form', () => {
  it('✅ "Repeat…" from a transaction: monthly on the last day, asks for notifications once', async () => {
    const ts = createTestSession({ permission: 'undetermined' });
    const l = ts.ledger;
    const tx = must(l.repos.transactions.create(l.expense({ occurredOn: d('2026-08-31') })));
    const onDone = jest.fn();
    await renderWithSession(
      <RecurringFormScreen ruleId={null} transactionId={tx.id} onDone={onDone} />,
      ts,
    );
    expect(screen.getByText(/Months without this day use their last day/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('month-day-last'));
    await fireEvent.press(screen.getByTestId('mode-confirm_before_post'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('recurring-save'));
    });
    expect(onDone).toHaveBeenCalled();
    const [rule] = l.repos.recurring.list().rules;
    expect(rule).toMatchObject({
      mode: 'confirm_before_post',
      schedule: { pattern: { frequency: 'monthly', byMonthDay: -1 } },
    });
    // The start was in the past: Sep 30 is already waiting in Upcoming.
    expect(l.repos.transactions.listPending().map((p) => p.occurredOn)).toEqual(['2026-09-30']);
    expect(ts.notifications.requests).toBe(1);
  });

  it('❌ weekly with no weekday is refused', async () => {
    const ts = createTestSession();
    const tx = must(ts.ledger.repos.transactions.create(ts.ledger.expense()));
    await renderWithSession(
      <RecurringFormScreen ruleId={null} transactionId={tx.id} onDone={jest.fn()} />,
      ts,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Weekly' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Thu' })); // untick the default
    await act(async () => {
      await fireEvent.press(screen.getByTestId('recurring-save'));
    });
    expect(screen.getByText('Choose at least one valid weekday')).toBeOnTheScreen();
    expect(ts.ledger.repos.recurring.list().rules).toEqual([]);
  });

  it('edit: pause, and delete after confirmation', async () => {
    const ts = createTestSession();
    const { ruleId } = rent(ts.ledger, 'auto_post');
    const onDone = jest.fn();
    await renderWithSession(
      <RecurringFormScreen ruleId={ruleId} transactionId={null} onDone={onDone} />,
      ts,
    );
    await fireEvent.press(screen.getByTestId('recurring-pause'));
    expect(ts.ledger.repos.recurring.get(ruleId)?.isPaused).toBe(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await fireEvent.press(screen.getByTestId('recurring-delete'));
    expect(alert).toHaveBeenCalled();
    expect(ts.ledger.repos.recurring.get(ruleId)).toBeNull();
    alert.mockRestore();
  });

  it('rules list shows schedule, mode and next date', async () => {
    const ts = createTestSession();
    const { ruleId } = rent(ts.ledger, 'auto_post');
    await renderWithSession(<RecurringListScreen onOpen={jest.fn()} />, ts);
    expect(screen.getByTestId(`rule-${ruleId}`)).toHaveTextContent(
      /Every 1 month\(s\) on day 1 · Record automatically · Next: 1 November 2026/,
    );
  });

  it('transaction detail offers "Repeat…" or links to its rule', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const plain = must(l.repos.transactions.create(l.expense()));
    const { txId, ruleId } = rent(l, 'auto_post');
    const onRepeat = jest.fn();
    const onOpenRule = jest.fn();
    const first0 = await renderWithSession(
      <TransactionDetailScreen
        id={plain.id}
        onEdit={jest.fn()}
        onDeleted={jest.fn()}
        onRepeat={onRepeat}
        onOpenRule={onOpenRule}
      />,
      ts,
    );
    await fireEvent.press(screen.getByTestId('repeat'));
    expect(onRepeat).toHaveBeenCalledWith(plain.id);
    await act(async () => first0.unmount());
    await renderWithSession(
      <TransactionDetailScreen
        id={txId}
        onEdit={jest.fn()}
        onDeleted={jest.fn()}
        onRepeat={onRepeat}
        onOpenRule={onOpenRule}
      />,
      ts,
    );
    await fireEvent.press(screen.getByTestId('view-rule'));
    expect(onOpenRule).toHaveBeenCalledWith(ruleId);
  });
});

describe('J6 budgets UI', () => {
  it('✅ create a food budget; at 80% it reads "Getting close" with an icon, not colour alone', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const onDone = jest.fn();
    const first1 = await renderWithSession(<BudgetFormScreen id={null} onDone={onDone} />, ts);
    await fireEvent.press(screen.getByTestId(`budget-cat-${l.ids.food}`));
    await fireEvent.changeText(screen.getByTestId('budget-amount'), '400');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('budget-save'));
    });
    expect(onDone).toHaveBeenCalled();
    const [b] = l.repos.budgets.list();
    expect(b).toMatchObject({ categoryId: l.ids.food, amountMinor: 40000, period: 'monthly' });

    must(l.repos.transactions.create(l.expense({ amountMinor: 32000 })));
    await act(async () => first1.unmount());
    await renderWithSession(<BudgetsScreen onOpen={jest.fn()} onAdd={jest.fn()} />, ts);
    const card = screen.getByTestId(`budget-${b?.id}`);
    expect(card).toHaveTextContent(/⚠ Getting close/);
    expect(card).toHaveTextContent(/320\.00.*of.*400\.00/);
    expect(screen.getByTestId(`budget-bar-${b?.id}`).props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 80,
    });
    expect(screen.getByTestId(`safe-${b?.id}`)).toHaveTextContent(/Safe to spend today/);
  });

  it('❌ invalid amount and duplicate budget are explained', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    must(
      l.repos.budgets.create({
        categoryId: l.ids.food,
        period: 'monthly',
        amountMinor: 1000,
        rollover: false,
        thresholds: [80],
      }),
    );
    await renderWithSession(<BudgetFormScreen id={null} onDone={jest.fn()} />, ts);
    await fireEvent.press(screen.getByTestId('budget-save'));
    expect(screen.getByText('Enter a valid amount')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`budget-cat-${l.ids.food}`));
    await fireEvent.changeText(screen.getByTestId('budget-amount'), '50');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('budget-save'));
    });
    expect(screen.getByText(/already has a budget/)).toBeOnTheScreen();
  });

  it('❌ archived category budget prompts the user', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const b = must(
      l.repos.budgets.create({
        categoryId: l.ids.food,
        period: 'monthly',
        amountMinor: 1000,
        rollover: false,
        thresholds: [80],
      }),
    );
    l.repos.categories.setArchived(l.ids.food, true);
    await renderWithSession(<BudgetsScreen onOpen={jest.fn()} onAdd={jest.fn()} />, ts);
    expect(screen.getByTestId(`archived-${b.id}`)).toHaveTextContent(/category is archived/);
  });

  it('Home: budget strip, safe to spend and the Upcoming banner', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    must(
      l.repos.budgets.create({
        categoryId: null,
        period: 'monthly',
        amountMinor: 170000,
        rollover: false,
        thresholds: [80],
      }),
    );
    must(l.repos.transactions.create(l.expense({ amountMinor: 1000 })));
    rent(l, 'confirm_before_post');
    setDay(l, '2026-11-02');
    run(l);
    setDay(l, '2026-10-15');
    const n = homeNav();
    await renderWithSession(<HomeScreen nav={n} />, ts);
    expect(screen.getByTestId('budget-strip')).toHaveTextContent(/All spending/);
    // (1,700.00 - 10.00 - 500.00 rent) / 17 days
    expect(screen.getByTestId('budget-strip')).toHaveTextContent(/Safe to spend today: 70\.00/);
    expect(screen.getByTestId('upcoming-banner')).toHaveTextContent(/Waiting for you: 1/);
    await fireEvent.press(screen.getByRole('button', { name: 'Open' }));
    expect(n.onUpcoming).toHaveBeenCalled();
  });

  it('Home: "recorded" notice after an engine run (J5 user notified)', async () => {
    const ts = createTestSession();
    ts.planningNotice.current = {
      posted: 2,
      pending: 0,
      reviewRuleIds: [],
      failedRuleIds: [],
      alerts: [],
    };
    const n = homeNav();
    await renderWithSession(<HomeScreen nav={n} />, ts);
    expect(screen.getByTestId('planning-notice')).toHaveTextContent(
      /Recurring transactions recorded: 2/,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Open' }));
    expect(ts.planningNotice.current).toBeNull();
    expect(n.onUpcoming).toHaveBeenCalled();
  });

  it('Arabic: budgets render translated with Eastern Arabic digits', async () => {
    const ts = createTestSession({ locale: 'ar' });
    const l = ts.ledger;
    l.repos.settings.set('numerals', 'arab');
    must(
      l.repos.budgets.create({
        categoryId: l.ids.food,
        period: 'monthly',
        amountMinor: 40000,
        rollover: false,
        thresholds: [80],
      }),
    );
    must(l.repos.transactions.create(l.expense({ amountMinor: 32000 })));
    await renderWithSession(<BudgetsScreen onOpen={jest.fn()} onAdd={jest.fn()} />, ts, 'ar');
    expect(screen.getByText(/اقتربت من الحد/)).toBeOnTheScreen();
    expect(screen.getByText(/آمن للإنفاق اليوم/)).toBeOnTheScreen();
    expect(screen.queryByText(/budgets\./)).toBeNull();
  });
});

describe('J6 category merge UI', () => {
  it('❌ clashing budgets: the user chooses to combine', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    for (const [categoryId, amountMinor] of [
      [l.ids.food, 40000],
      [l.ids.kids, 10000],
    ] as const) {
      must(
        l.repos.budgets.create({
          categoryId,
          period: 'monthly',
          amountMinor,
          rollover: false,
          thresholds: [80],
        }),
      );
    }
    const { refresh } = await renderWithSession(<CategoriesScreen />, ts);
    await fireEvent.press(screen.getByRole('button', { name: 'Food, Rename' }));
    await fireEvent.press(screen.getByTestId(`merge-${l.ids.food}`));
    await fireEvent.press(screen.getByTestId(`merge-into-${l.ids.kids}`));
    expect(screen.getByText(/Both categories have a budget/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('merge-combine'));
    await refresh();
    expect(screen.getByTestId('merge-done')).toHaveTextContent(/Categories merged/);
    expect(l.repos.budgets.list().map((b) => [b.categoryId, b.amountMinor])).toEqual([
      [l.ids.kids, 50000],
    ]);
    expect(l.repos.categories.get(l.ids.food)?.isArchived).toBe(true);
  });
});

describe('goals UI', () => {
  it('create a goal linked to an account and see the monthly amount needed', async () => {
    const ts = createTestSession();
    const l = ts.ledger;
    const first2 = await renderWithSession(<GoalFormScreen id={null} onDone={jest.fn()} />, ts);
    await fireEvent.changeText(screen.getByTestId('goal-name'), 'Car');
    await fireEvent.press(screen.getByTestId(`goal-account-${l.ids.bank}`));
    await fireEvent.changeText(screen.getByTestId('goal-target'), '10000');
    await fireEvent.changeText(screen.getByTestId('goal-date'), '2027-03-31');
    await fireEvent.press(screen.getByTestId('goal-save'));
    const [g] = l.repos.goals.list();
    expect(g).toMatchObject({ name: 'Car', targetMinor: 1000000, linkedAccountId: l.ids.bank });
    await act(async () => first2.unmount());
    await renderWithSession(<GoalsScreen onOpen={jest.fn()} onAdd={jest.fn()} />, ts);
    expect(screen.getByTestId(`goal-monthly-${g?.id}`)).toHaveTextContent(
      /Save 1,500\.00.*a month/,
    );
  });

  it('❌ bad target and past date are refused', async () => {
    const ts = createTestSession();
    await renderWithSession(<GoalFormScreen id={null} onDone={jest.fn()} />, ts);
    await fireEvent.changeText(screen.getByTestId('goal-name'), 'Trip');
    await fireEvent.changeText(screen.getByTestId('goal-target'), '0');
    await fireEvent.press(screen.getByTestId('goal-save'));
    expect(screen.getByText('Enter a valid target amount')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('goal-target'), '100');
    await fireEvent.changeText(screen.getByTestId('goal-date'), '2020-01-01');
    await fireEvent.press(screen.getByTestId('goal-save'));
    expect(screen.getByText('The target date is in the past')).toBeOnTheScreen();
    expect(ts.ledger.repos.goals.list()).toEqual([]);
  });
});
