import { router, useLocalSearchParams } from 'expo-router';

import { BudgetFormScreen } from '@/features/budgets/budget-form-screen';

export default function BudgetRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BudgetFormScreen id={id === 'new' ? null : id} onDone={() => router.back()} />;
}
