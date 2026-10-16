import { isScheduled, money, type CurrencyCode, type LocalDate } from '@/domain';
import type { ListItem } from '@/data/repositories/transactions-repository';
import type { AccountRow } from '@/data/repositories/accounts-repository';
import type { CategoryRow } from '@/data/repositories/categories-repository';
import { AmountText, ListRow, Stack, Text } from '@/ui';

import type { Formatter } from '../session/use-format';

export function TransactionRow({
  item,
  f,
  today,
  categories,
  accounts,
  onPress,
  trailingAction,
}: {
  item: ListItem;
  f: Formatter;
  today: LocalDate;
  categories: ReadonlyMap<string, CategoryRow>;
  accounts: ReadonlyMap<string, AccountRow>;
  onPress?: () => void;
  trailingAction?: React.ReactNode;
}) {
  const { t } = f;
  const cat = item.categoryId ? categories.get(item.categoryId) : undefined;
  const from = accounts.get(item.accountId)?.name ?? '';
  const to = item.toAccountId ? (accounts.get(item.toAccountId)?.name ?? '') : '';
  const title =
    item.type === 'transfer'
      ? t('transactions.transfer', { from, to })
      : item.splitCount > 1
        ? `${f.categoryName(cat)} · ${t('transactions.split', { count: f.digits(item.splitCount) })}`
        : f.categoryName(cat);
  const subtitleParts = [
    f.date(item.occurredOn),
    item.payeeName,
    item.note,
    item.attachmentCount > 0 ? `📎 ${f.digits(item.attachmentCount)}` : null,
  ].filter(Boolean);
  const scheduled = isScheduled(item.occurredOn, today);
  const m = money(item.amountMinor, item.currency as CurrencyCode);
  const kindLabel =
    item.type === 'income'
      ? 'amount.income'
      : item.type === 'expense'
        ? 'amount.expense'
        : 'amount.transfer';
  return (
    <ListRow
      testID={`tx-${item.id}`}
      icon={item.type === 'transfer' ? '⇄' : (cat?.icon ?? '•')}
      title={title}
      subtitle={subtitleParts.join(' · ')}
      onPress={onPress}
      accessibilityLabel={`${title}, ${t(kindLabel, { amount: f.money(m) })}, ${subtitleParts.join(', ')}${scheduled ? `, ${t('transactions.scheduledBadge')}` : ''}`}
      trailing={
        <Stack gap="xxs" style={{ alignItems: 'flex-end' }}>
          <AmountText
            money={m}
            kind={item.type}
            spokenLabel={(a) => t(kindLabel, { amount: a })}
            format={{ numerals: f.arabicDigits ? 'arab' : 'latn' }}
          />
          {scheduled ? (
            <Text variant="caption" tone="warning">
              ⏱ {t('transactions.scheduledBadge')}
            </Text>
          ) : null}
          {trailingAction}
        </Stack>
      }
    />
  );
}
