import { create } from 'zustand';

import { shouldLockOnResume } from '@/domain';

type LockStore = {
  /** App content hidden behind the lock screen. */
  locked: boolean;
  /** App not in the foreground: show the privacy cover (app-switcher snapshot). */
  covered: boolean;
  backgroundedAt: number | null;
  lockNow: () => void;
  unlock: () => void;
  onAppState: (
    state: string,
    params: { lockEnabled: boolean; timeoutSeconds: number; now: number },
  ) => void;
};

/**
 * Auto-lock (spec 7): lock when the app returns after `timeoutSeconds` in the
 * background; always cover content while not active so the OS snapshot
 * shows no balances.
 */
export const useLockStore = create<LockStore>((set, get) => ({
  locked: false,
  covered: false,
  backgroundedAt: null,
  lockNow: () => set({ locked: true }),
  unlock: () => set({ locked: false, backgroundedAt: null }),
  onAppState(state, { lockEnabled, timeoutSeconds, now }) {
    if (state === 'active') {
      const lock = lockEnabled && shouldLockOnResume(get().backgroundedAt, now, timeoutSeconds);
      set((s) => ({ covered: false, locked: s.locked || lock, backgroundedAt: null }));
    } else {
      set((s) => ({
        covered: true,
        backgroundedAt: state === 'background' ? (s.backgroundedAt ?? now) : s.backgroundedAt,
      }));
    }
  },
}));
