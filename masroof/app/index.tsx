import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HomeScreen } from '@/features/home/home-screen';
import { lastDay } from '@/domain';
import { Button, Row } from '@/ui';

export default function HomeRoute() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Row gap="xs">
              <Button
                label="☰"
                variant="secondary"
                accessibilityLabel={t('transactions.title')}
                onPress={() => router.push('/transactions')}
              />
              <Button
                label="⚙"
                variant="secondary"
                accessibilityLabel={t('settings.title')}
                onPress={() => router.push('/settings')}
              />
            </Row>
          ),
        }}
      />
      <HomeScreen
        nav={{
          onAdd: (date) => router.push({ pathname: '/add', params: date ? { date } : {} }),
          onDay: (date) =>
            router.push({ pathname: '/transactions', params: { from: date, to: date } }),
          onCategory: (categoryId, period) =>
            router.push({
              pathname: '/transactions',
              params: { categoryId, from: period.start, to: lastDay(period) },
            }),
          onAllTransactions: () => router.push('/transactions'),
          onSettings: () => router.push('/settings'),
          onAccounts: () => router.push('/accounts'),
        }}
      />
    </>
  );
}
