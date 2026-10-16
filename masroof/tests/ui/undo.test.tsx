import { act } from '@testing-library/react-native';

import { UNDO_WINDOW_MS, useUndoStore } from '@/features/undo/undo-store';

describe('undo snackbar (J7)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays for 5 seconds, then the undo is gone', () => {
    const onUndo = jest.fn();
    useUndoStore.getState().show('Transaction deleted', { label: 'Undo', onPress: onUndo });
    act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS - 1));
    expect(useUndoStore.getState().current?.message).toBe('Transaction deleted');
    act(() => jest.advanceTimersByTime(2));
    expect(useUndoStore.getState().current).toBeNull();
    expect(UNDO_WINDOW_MS).toBe(5000);
  });

  it('a newer snackbar replaces the older one and gets its own full window', () => {
    useUndoStore.getState().show('first');
    act(() => jest.advanceTimersByTime(4000));
    useUndoStore.getState().show('second');
    act(() => jest.advanceTimersByTime(4000));
    expect(useUndoStore.getState().current?.message).toBe('second');
    act(() => jest.advanceTimersByTime(1001));
    expect(useUndoStore.getState().current).toBeNull();
  });
});
