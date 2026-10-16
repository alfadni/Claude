import { useUndoStore } from '@/features/undo/undo-store';

/**
 * Screen tests boot an in-memory SQLite ledger and render whole screens. Under
 * coverage on a loaded CI runner, the first test in each file also pays the
 * module-load cost and exceeded Jest's 5 s default (reproduced locally by
 * running two coverage runs concurrently). Give UI tests a realistic budget.
 */
jest.setTimeout(30000);

// The undo snackbar keeps a 5 s timer; clear it so no test leaks a live handle.
afterEach(() => useUndoStore.getState().dismiss());
