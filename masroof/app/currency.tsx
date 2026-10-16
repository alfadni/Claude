import { router } from 'expo-router';

import { BaseCurrencyScreen } from '@/features/fx/base-currency-screen';

export default function CurrencyRoute() {
  return (
    <BaseCurrencyScreen onBackup={() => router.push('/backup')} onDone={() => router.back()} />
  );
}
