import { router, useLocalSearchParams } from 'expo-router';

import { GoalFormScreen } from '@/features/goals/goal-form-screen';

export default function GoalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GoalFormScreen id={id === 'new' ? null : id} onDone={() => router.back()} />;
}
