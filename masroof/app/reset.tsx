import { router } from 'expo-router';

import { useBootStore } from '@/features/boot/boot-store';
import { ResetScreen } from '@/features/reset/reset-screen';

export default function ResetRoute() {
  const state = useBootStore();
  if (state.status !== 'ready') return null;
  return (
    <ResetScreen
      reset={state.services.reset}
      onBackup={() => router.push('/backup')}
      onDone={state.services.platform.reloadApp}
      onCancel={() => router.back()}
    />
  );
}
