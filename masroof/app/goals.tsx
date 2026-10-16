import { router } from 'expo-router';

import { GoalsScreen } from '@/features/goals/goals-screen';

export default function GoalsRoute() {
  return (
    <GoalsScreen
      onOpen={(id) => router.push({ pathname: '/goal/[id]', params: { id } })}
      onAdd={() => router.push({ pathname: '/goal/[id]', params: { id: 'new' } })}
    />
  );
}
