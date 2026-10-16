import { router } from 'expo-router';

import { UpcomingScreen } from '@/features/planning/upcoming-screen';

export default function UpcomingRoute() {
  return (
    <UpcomingScreen
      onOpenRule={(id) => router.push({ pathname: '/rule/[id]', params: { id } })}
      onManageRules={() => router.push('/recurring')}
    />
  );
}
