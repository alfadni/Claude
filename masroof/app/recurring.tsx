import { router } from 'expo-router';

import { RecurringListScreen } from '@/features/planning/recurring-list-screen';

export default function RecurringRoute() {
  return (
    <RecurringListScreen onOpen={(id) => router.push({ pathname: '/rule/[id]', params: { id } })} />
  );
}
