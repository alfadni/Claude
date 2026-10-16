import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { money, type CurrencyCode } from '@/domain';
import { Button, Chip, ListRow, spacing, Text, useTheme } from '@/ui';

import { useLedger } from '../session/session';
import { tDynamic, useFormat } from '../session/use-format';

export function AccountsScreen({
  onOpen,
  onAdd,
}: {
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useLedger(
    (r) => r.accounts.list({ includeArchived: showArchived }),
    [showArchived],
  );
  const balances = useLedger((r) => r.accounts.balances(r.today()), []);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        testID="accounts"
      >
        <Button label={t('accounts.add')} onPress={onAdd} testID="add-account" />
        {accounts.map((a) => (
          <ListRow
            key={a.id}
            testID={`account-${a.id}`}
            icon={a.icon}
            title={a.name}
            subtitle={[
              tDynamic(t, `accounts.types.${a.type}`),
              a.currency,
              a.isArchived ? t('accounts.archived') : null,
              a.includeInTotals ? null : `✕ ${t('accounts.includeInTotals')}`,
            ]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => onOpen(a.id)}
            trailing={
              <Text>
                {f.money(
                  money(balances.get(a.id) ?? a.openingBalanceMinor, a.currency as CurrencyCode),
                )}
              </Text>
            }
          />
        ))}
        <Chip
          role="checkbox"
          label={t('accounts.showArchived')}
          selected={showArchived}
          onPress={() => setShowArchived(!showArchived)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
