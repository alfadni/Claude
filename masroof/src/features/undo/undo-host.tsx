import { Snackbar } from '@/ui';

import { useUndoStore } from './undo-store';

export function UndoHost() {
  const current = useUndoStore((s) => s.current);
  const dismiss = useUndoStore((s) => s.dismiss);
  if (!current) return null;
  return (
    <Snackbar
      key={current.key}
      message={current.message}
      action={
        current.onAction && current.actionLabel
          ? {
              label: current.actionLabel,
              onPress: () => {
                current.onAction?.();
                dismiss();
              },
            }
          : undefined
      }
    />
  );
}
