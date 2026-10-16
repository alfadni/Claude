import { router, useLocalSearchParams } from 'expo-router';

import { isLocalDate, type LocalDate, type TransactionType } from '@/domain';
import { QuickAddScreen } from '@/features/quick-add/quick-add-screen';

const TYPES: readonly string[] = ['expense', 'income', 'transfer'];

export default function AddRoute() {
  const p = useLocalSearchParams<{ id?: string; type?: string; date?: string }>();
  return (
    <QuickAddScreen
      editId={p.id ?? null}
      initialType={p.type && TYPES.includes(p.type) ? (p.type as TransactionType) : null}
      initialDate={p.date && isLocalDate(p.date) ? (p.date as LocalDate) : null}
      onDone={() => router.back()}
      onCancel={() => router.back()}
    />
  );
}
