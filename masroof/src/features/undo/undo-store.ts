import { create } from 'zustand';

export const UNDO_WINDOW_MS = 5000;

type Pending = { key: number; message: string; actionLabel?: string; onAction?: () => void };

type UndoStore = {
  current: Pending | null;
  show: (message: string, action?: { label: string; onPress: () => void }) => void;
  dismiss: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

/** One snackbar at a time; a new one replaces the old (whose undo then expires). */
export const useUndoStore = create<UndoStore>((set) => ({
  current: null,
  show(message, action) {
    if (timer) clearTimeout(timer);
    const key = ++seq;
    set({ current: { key, message, actionLabel: action?.label, onAction: action?.onPress } });
    timer = setTimeout(() => {
      set((s) => (s.current?.key === key ? { current: null } : s));
    }, UNDO_WINDOW_MS);
  },
  dismiss() {
    if (timer) clearTimeout(timer);
    set({ current: null });
  },
}));
