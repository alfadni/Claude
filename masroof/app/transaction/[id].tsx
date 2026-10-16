import { router, useLocalSearchParams } from 'expo-router';

import { TransactionDetailScreen } from '@/features/transactions/detail-screen';

export default function TransactionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <TransactionDetailScreen
      id={id}
      onEdit={(txId) => router.push({ pathname: '/add', params: { id: txId } })}
      onDeleted={() => router.back()}
      onRepeat={(txId) => router.push({ pathname: '/rule/[id]', params: { id: 'new', tx: txId } })}
      onOpenRule={(ruleId) => router.push({ pathname: '/rule/[id]', params: { id: ruleId } })}
    />
  );
}
