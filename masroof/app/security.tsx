import { router } from 'expo-router';

import { SecurityScreen } from '@/features/security/security-screen';

export default function SecurityRoute() {
  return <SecurityScreen onBackup={() => router.push('/backup')} />;
}
