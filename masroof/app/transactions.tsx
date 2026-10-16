import { router, useLocalSearchParams } from 'expo-router';

import { isLocalDate, type LocalDate } from '@/domain';
import { TransactionsListScreen } from '@/features/transactions/list-screen';

export default function TransactionsRoute() {
  const p = useLocalSearchParams<{ from?: string; to?: string; categoryId?: string }>();
  const date = (s?: string) => (s && isLocalDate(s) ? (s as LocalDate) : null);
  return (
    <TransactionsListScreen
      params={{ from: date(p.from), to: date(p.to), categoryId: p.categoryId ?? null }}
      onOpen={(id) => router.push({ pathname: '/transaction/[id]', params: { id } })}
    />
  );
}
