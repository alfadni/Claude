import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { addDays } from '@/domain';
import { initialState } from '@/features/quick-add/form-state';
import { QuickAddScreen } from '@/features/quick-add/quick-add-screen';
import { useUndoStore } from '@/features/undo/undo-store';

import { createTestSession, renderWithSession } from './ledger-session';

jest.mock('@react-native-community/datetimepicker', () => () => null);

async function press(...keys: string[]) {
  for (const k of keys) await fireEvent.press(screen.getByRole('button', { name: k }));
}

async function setup(props: Partial<Parameters<typeof QuickAddScreen>[0]> = {}) {
  const ts = createTestSession();
  const onDone = jest.fn();
  const onCancel = jest.fn();
  const utils = await renderWithSession(
    <QuickAddScreen onDone={onDone} onCancel={onCancel} {...props} />,
    ts,
  );
  return { ts, onDone, onCancel, ...utils };
}

const saveButton = () => screen.getByTestId('save');

describe('Quick add (J2)', () => {
  beforeEach(() => useUndoStore.getState().dismiss());

  it('happy path: amount → category → save', async () => {
    const { ts, onDone } = await setup();
    await press('1', '2');
    expect(saveButton()).toBeDisabled(); // no category yet
    await fireEvent.press(screen.getByRole('radio', { name: 'Food' }));
    expect(saveButton()).toBeEnabled();
    await fireEvent.press(saveButton());
    expect(onDone).toHaveBeenCalledWith(expect.any(String));
    const [tx] = ts.ledger.repos.transactions.list({}, null);
    expect(tx).toMatchObject({ amountMinor: 1200, type: 'expense', accountId: ts.ledger.ids.cash });
    expect(ts.bumps()).toBeGreaterThan(0); // home/calendar re-read immediately
  });

  it('calculator expression shows the result', async () => {
    await setup();
    await press('1', '2', 'plus', '8', 'decimal point', '5');
    expect(screen.getByTestId('amount-result')).toHaveTextContent('= 20.50\u00A0USD');
  });

  it('invalid expression 12++: error, last valid value kept, save disabled', async () => {
    await setup();
    await press('1', '2', 'plus', 'plus');
    await fireEvent.press(screen.getByRole('radio', { name: 'Food' }));
    expect(screen.getByTestId('amount-error')).toHaveTextContent(
      'That expression is not valid (12.00\u00A0USD)',
    );
    expect(saveButton()).toBeDisabled();
    await press('Delete last digit', '3');
    expect(screen.queryByTestId('amount-error')).toBeNull();
    expect(saveButton()).toBeEnabled();
  });

  it('zero amount: inline error and save disabled', async () => {
    await setup();
    await press('0');
    await fireEvent.press(screen.getByRole('radio', { name: 'Food' }));
    expect(screen.getByTestId('amount-error')).toHaveTextContent('Amount must be more than zero');
    expect(saveButton()).toBeDisabled();
  });

  it('more than 15 digits: inline error', async () => {
    await setup();
    await press(...'1234567890123456'.split(''));
    expect(screen.getByTestId('amount-error')).toHaveTextContent(
      'Amount is too large (15 digits max)',
    );
  });

  it('future date: labelled Scheduled with a warning, still savable', async () => {
    const ts0 = createTestSession();
    const future = addDays(ts0.ledger.repos.today(), 3);
    const onDone = jest.fn();
    await renderWithSession(
      <QuickAddScreen onDone={onDone} onCancel={jest.fn()} initialDate={future} />,
      ts0,
    );
    await press('5');
    await fireEvent.press(screen.getByRole('radio', { name: 'Food' }));
    expect(screen.getByTestId('scheduled-label')).toBeOnTheScreen();
    expect(screen.getByTestId('warning-scheduled')).toBeOnTheScreen();
    await fireEvent.press(saveButton());
    expect(onDone).toHaveBeenCalled();
  });

  it('photo permission denied: explains, deep-links to Settings, transaction still saves', async () => {
    const { ts, onDone } = await setup();
    ts.pick.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
    expect(screen.getByTestId('photo-denied')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(ts.openSettings).toHaveBeenCalled();
    await press('5');
    await fireEvent.press(screen.getByRole('radio', { name: 'Food' }));
    await fireEvent.press(saveButton());
    expect(onDone).toHaveBeenCalled();
  });

  it('photo saved with the transaction; storage full keeps the transaction and offers retry', async () => {
    const { ts, onDone } = await setup();
    ts.pick.mockResolvedValue({ status: 'picked', uri: 'file:///receipt.jpg', width: 800 });
    await fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
    expect(screen.getByLabelText('Receipt photo 1')).toBeOnTheScreen();
    ts.addResult.next = 'storage_full';
    await press('5');
    await fireEvent.press(screen.getByRole('radio', { name: 'Food' }));
    await act(async () => {
      await fireEvent.press(saveButton());
    });
    const id = onDone.mock.calls[0]?.[0] as string;
    expect(ts.ledger.repos.transactions.get(id)?.deletedAt).toBeNull();
    expect(ts.ledger.repos.attachments.listFor(id)).toEqual([]);
    const snack = useUndoStore.getState().current;
    expect(snack?.message).toBe('Not enough storage to save the photo. The transaction was saved.');
    ts.addResult.next = null;
    await act(async () => {
      snack?.onAction?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ts.ledger.repos.attachments.listFor(id)).toHaveLength(1);
  });

  it('backgrounded mid-entry: draft restored on reopen, discardable', async () => {
    const ts = createTestSession();
    ts.ledger.repos.drafts.save('quick-add', {
      ...initialState({
        today: ts.ledger.repos.today(),
        accountId: ts.ledger.ids.cash,
      }),
      expression: '42',
      lastValidMinor: 4200,
    });
    await renderWithSession(<QuickAddScreen onDone={jest.fn()} onCancel={jest.fn()} />, ts);
    expect(screen.getByText('Your unsaved entry was restored.')).toBeOnTheScreen();
    expect(screen.getByTestId('amount-display')).toHaveTextContent('42');
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByTestId('amount-display')).toHaveTextContent('0');
    expect(ts.ledger.repos.drafts.load('quick-add')).toBeNull();
  });
});

describe('Quick add: J3 splits', () => {
  it('live remaining; save blocked until splits add up; saves both parts', async () => {
    const { ts, onDone } = await setup();
    await press('1', '2', '3');
    await fireEvent.press(screen.getByRole('radio', { name: 'Clothes' }));
    await fireEvent.press(screen.getByTestId('split-toggle'));
    await fireEvent.changeText(screen.getByTestId('split-amount-0'), '80');
    const kidsChips = screen.getAllByRole('radio', { name: 'Kids' });
    await fireEvent.press(kidsChips[1] as never);
    await fireEvent.changeText(screen.getByTestId('split-amount-1'), '40');
    expect(screen.getByTestId('split-remaining')).toHaveTextContent('Remaining: 3.00\u00A0USD');
    expect(saveButton()).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('split-amount-1'), '43');
    expect(screen.getByTestId('split-remaining')).toHaveTextContent(/Fully split/);
    await fireEvent.press(saveButton());
    const id = onDone.mock.calls[0]?.[0] as string;
    expect(ts.ledger.repos.transactions.get(id)?.splits.map((s) => s.amountMinor)).toEqual([
      8000, 4300,
    ]);
  });

  it('removing split mode asks for confirmation and collapses to one category', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    await setup();
    await press('1', '0');
    await fireEvent.press(screen.getByRole('radio', { name: 'Food' }));
    await fireEvent.press(screen.getByTestId('split-toggle'));
    expect(screen.getByTestId('split-editor')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('split-toggle'));
    expect(alert).toHaveBeenCalledWith(
      'Remove split?',
      'The whole amount will go to Food.',
      expect.any(Array),
    );
    expect(screen.queryByTestId('split-editor')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Food' })).toBeChecked();
    alert.mockRestore();
  });
});

describe('Quick add: J4 transfers', () => {
  it('cross-currency: enter both legs, derived rate shown, saves both', async () => {
    const ts = createTestSession();
    const wallet = ts.ledger.repos.accounts.create({
      name: 'Wallet',
      type: 'mobile_wallet',
      currency: 'SDG',
      openingBalanceMinor: 0,
      openedOn: null,
      includeInTotals: true,
    });
    if (!wallet.ok) throw new Error();
    const onDone = jest.fn();
    await renderWithSession(
      <QuickAddScreen onDone={onDone} onCancel={jest.fn()} initialType="transfer" />,
      ts,
    );
    await press('1', '0', '0');
    await fireEvent.press(screen.getAllByRole('radio', { name: 'Wallet · SDG' }).at(-1) as never);
    expect(saveButton()).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('to-amount'), '60050');
    expect(screen.getByTestId('implied-rate')).toHaveTextContent('Rate: 1 USD = 600.5 SDG');
    await fireEvent.press(saveButton());
    const id = onDone.mock.calls[0]?.[0] as string;
    expect(ts.ledger.repos.transactions.get(id)).toMatchObject({
      type: 'transfer',
      amountMinor: 10000,
      toAmountMinor: 6005000,
    });
  });

  it('insufficient balance shows a warning but allows saving', async () => {
    const ts = createTestSession();
    const onDone = jest.fn();
    await renderWithSession(
      <QuickAddScreen onDone={onDone} onCancel={jest.fn()} initialType="transfer" />,
      ts,
    );
    await press('9', '9', '9');
    await fireEvent.press(screen.getAllByRole('radio', { name: 'Bank · USD' }).at(-1) as never);
    expect(screen.getByTestId('warning-insufficient_balance')).toBeOnTheScreen();
    await fireEvent.press(saveButton());
    expect(onDone).toHaveBeenCalled();
  });

  it('cannot pick the source as destination', async () => {
    const ts = createTestSession();
    await renderWithSession(
      <QuickAddScreen onDone={jest.fn()} onCancel={jest.fn()} initialType="transfer" />,
      ts,
    );
    // Source is Cash (last used/default): it is not offered as a destination.
    expect(screen.getAllByRole('radio', { name: 'Cash · USD' })).toHaveLength(1);
  });
});

describe('Quick add: J7 edit', () => {
  it('edits in place', async () => {
    const ts = createTestSession();
    const created = ts.ledger.repos.transactions.create(
      ts.ledger.expense({
        amountMinor: 500,
        splits: [{ categoryId: ts.ledger.ids.food, amountMinor: 500 }],
      }),
    );
    if (!created.ok) throw new Error();
    const onDone = jest.fn();
    await renderWithSession(
      <QuickAddScreen editId={created.value.id} onDone={onDone} onCancel={jest.fn()} />,
      ts,
    );
    expect(screen.getByTestId('amount-display')).toHaveTextContent('5.00');
    await press(
      'Delete last digit',
      'Delete last digit',
      'Delete last digit',
      'Delete last digit',
      '7',
    );
    await fireEvent.press(saveButton());
    expect(ts.ledger.repos.transactions.get(created.value.id)?.amountMinor).toBe(700);
  });

  it('recurring-generated: asks "this one only / this and future"', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => buttons?.[0]?.onPress?.());
    const ts = createTestSession();
    const created = ts.ledger.repos.transactions.create(ts.ledger.expense());
    if (!created.ok) throw new Error();
    ts.ledger.sql.run(
      `INSERT INTO recurring_rules (id, created_at, updated_at, rrule, tz, template_json, mode, starts_on) VALUES ('r',1,1,'FREQ=MONTHLY','UTC','{}','auto_post','2026-01-01')`,
    );
    ts.ledger.sql.run(
      `UPDATE transactions SET recurring_rule_id = 'r', recurrence_key = 'r:1' WHERE id = ?`,
      [created.value.id],
    );
    const onDone = jest.fn();
    await renderWithSession(
      <QuickAddScreen editId={created.value.id} onDone={onDone} onCancel={jest.fn()} />,
      ts,
    );
    await press('Delete last digit', '1');
    await fireEvent.press(saveButton());
    expect(alert).toHaveBeenCalledWith(
      'Edit recurring transaction',
      'Apply this change to:',
      expect.any(Array),
    );
    expect(onDone).toHaveBeenCalled();
    alert.mockRestore();
  });
});
