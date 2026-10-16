import { useMemo } from 'react';
import { FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, spacing, Text, useTheme } from '@/ui';

import { useLedger, useSession } from '../session/session';
import { useFormat } from '../session/use-format';
import { useUndoStore } from '../undo/undo-store';
import { TransactionRow } from './transaction-row';

/** Undo window missed (J7): deleted items stay here for 30 days. */
export function TrashScreen() {
  const session = useSession();
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const showSnack = useUndoStore((s) => s.show);
  const items = useLedger((r) => r.transactions.listTrash(), []);
  const accounts = useLedger((r) => r.accounts.list({ includeArchived: true }), []);
  const categories = useLedger((r) => r.categories.list(undefined, { includeArchived: true }), []);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const today = session.repos.today();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <FlatList
        testID="trash-list"
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
        ListHeaderComponent={<Text tone="muted">{t('trash.body')}</Text>}
        ListEmptyComponent={<EmptyState title={t('trash.emptyTitle')} />}
        renderItem={({ item }) => (
          <TransactionRow
            item={item}
            f={f}
            today={today}
            categories={categoryMap}
            accounts={accountMap}
            trailingAction={
              <Button
                label={t('common.restore')}
                variant="secondary"
                testID={`restore-${item.id}`}
                onPress={() => {
                  const r = session.repos.transactions.restore(item.id);
                  if (r.ok) {
                    session.bump();
                    showSnack(t('detail.restored'));
                  }
                }}
              />
            }
          />
        )}
      />
    </SafeAreaView>
  );
}
