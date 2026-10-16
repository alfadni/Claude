import { router, useLocalSearchParams } from 'expo-router';

import { AccountFormScreen } from '@/features/accounts/account-form-screen';

export default function AccountRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AccountFormScreen id={id === 'new' ? null : id} onDone={() => router.back()} />;
}
