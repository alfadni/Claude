import { router } from 'expo-router';

import { AccountsScreen } from '@/features/accounts/accounts-screen';

export default function AccountsRoute() {
  return (
    <AccountsScreen
      onOpen={(id) => router.push({ pathname: '/account/[id]', params: { id } })}
      onAdd={() => router.push({ pathname: '/account/[id]', params: { id: 'new' } })}
    />
  );
}
