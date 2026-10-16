import { router } from 'expo-router';

import { BudgetsScreen } from '@/features/budgets/budgets-screen';

export default function BudgetsRoute() {
  return (
    <BudgetsScreen
      onOpen={(id) => router.push({ pathname: '/budget/[id]', params: { id } })}
      onAdd={() => router.push({ pathname: '/budget/[id]', params: { id: 'new' } })}
    />
  );
}
