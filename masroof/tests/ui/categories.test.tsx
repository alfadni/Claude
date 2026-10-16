import { fireEvent, screen } from '@testing-library/react-native';

import { CategoriesScreen } from '@/features/categories/categories-screen';

import { createTestSession, renderWithSession } from './ledger-session';

describe('Categories screen (spec 5.14)', () => {
  it('adds, rejects blank names, renames, archives and unarchives', async () => {
    const ts = createTestSession();
    const utils = await renderWithSession(<CategoriesScreen />, ts);
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Enter a name')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('new-category'), 'Rent');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await utils.refresh();
    expect(screen.getByText('Rent')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Rent, Rename' }));
    await fireEvent.changeText(screen.getByDisplayValue('Rent'), 'House rent');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await utils.refresh();
    expect(screen.getByText('House rent')).toBeOnTheScreen();

    const rent = ts.ledger.repos.categories.list('expense').find((c) => c.name === 'House rent');
    expect(rent).toBeDefined();
    ts.ledger.repos.categories.setArchived(rent?.id ?? '', true);
    ts.session.bump();
    await utils.refresh();
    expect(screen.getByText('Archived')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Unarchive' }));
    expect(ts.ledger.repos.categories.get(rent?.id ?? '')?.isArchived).toBe(false);
  });

  it('reorders with move up / move down and shows income categories', async () => {
    const ts = createTestSession();
    const before = ts.ledger.repos.categories.list('expense').map((c) => c.id);
    await renderWithSession(<CategoriesScreen />, ts);
    expect(screen.getAllByRole('button', { name: 'Move up' })[0]).toBeDisabled();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Move down' })[0] as never);
    const after = ts.ledger.repos.categories.list('expense').map((c) => c.id);
    expect(after.slice(0, 2)).toEqual([before[1], before[0]]);
    await fireEvent.press(screen.getByRole('radio', { name: 'Income' }));
    expect(screen.getByText('Salary')).toBeOnTheScreen();
  });
});
