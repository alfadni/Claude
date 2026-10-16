import { router, useLocalSearchParams } from 'expo-router';

import { RecurringFormScreen } from '@/features/planning/recurring-form-screen';

export default function RuleRoute() {
  const { id, tx } = useLocalSearchParams<{ id: string; tx?: string }>();
  return (
    <RecurringFormScreen
      ruleId={id === 'new' ? null : id}
      transactionId={id === 'new' ? (tx ?? null) : null}
      onDone={() => router.back()}
    />
  );
}
