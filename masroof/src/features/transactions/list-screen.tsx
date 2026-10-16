import { useMemo, useState } from 'react';
import { SectionList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  lastDay,
  monthOf,
  parseSearch,
  previous,
  type LocalDate,
  type TransactionType,
} from '@/domain';
import type { ListFilter, ListItem } from '@/data/repositories/transactions-repository';
import { Button, Chip, EmptyState, Row, Segmented, spacing, Text, TextField, useTheme } from '@/ui';

import { useLedger, useSession } from '../session/session';
import { useFormat } from '../session/use-format';
import { TransactionRow } from './transaction-row';

const PAGE = 50;
type Range = 'month' | 'last' | 'all' | 'custom';

export type ListParams = Readonly<{
  from?: LocalDate | null;
  to?: LocalDate | null;
  categoryId?: string | null;
}>;

export function TransactionsListScreen({
  params,
  onOpen,
}: {
  params: ListParams;
  onOpen: (id: string) => void;
}) {
  const { repos, version } = useSession();
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const today = repos.today();

  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<'all' | TransactionType>('all');
  const [range, setRange] = useState<Range>(params.from ? 'custom' : 'month');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(params.categoryId ?? null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'day' | 'category'>('day');
  const [extra, setExtra] = useState<{ key: string; items: ListItem[]; lastPageFull: boolean }>({
    key: '',
    items: [],
    lastPageFull: false,
  });

  const accounts = useLedger((r) => r.accounts.list({ includeArchived: true }), []);
  const categories = useLedger((r) => r.categories.list(undefined, { includeArchived: true }), []);
  const tags = useLedger((r) => r.names.listTags(), []);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filter: ListFilter = useMemo(() => {
    const search = parseSearch(query, f.decimalSeparator);
    const month = monthOf(today);
    const dates =
      range === 'month'
        ? { from: month.start, to: lastDay(month) }
        : range === 'last'
          ? { from: previous(month).start, to: lastDay(previous(month)) }
          : range === 'custom'
            ? { from: params.from ?? null, to: params.to ?? params.from ?? null }
            : { from: null, to: null };
    return {
      text: search.text,
      amountsMinor: search.amountsMinor,
      ...dates,
      types: types === 'all' ? undefined : [types],
      accountIds: accountId ? [accountId] : undefined,
      categoryIds: categoryId ? [categoryId] : undefined,
      tagIds: tagId ? [tagId] : undefined,
    };
  }, [
    query,
    f.decimalSeparator,
    today,
    range,
    params.from,
    params.to,
    types,
    accountId,
    categoryId,
    tagId,
  ]);

  // Page 1 is a read model of (filter, data version); later pages are appended
  // only while that key is unchanged, so any edit or filter change resets paging.
  const firstPage = useLedger((r) => r.transactions.list(filter, null, PAGE), [filter]);
  const pageKey = `${JSON.stringify(filter)}#${version}`;
  const more = extra.key === pageKey ? extra : null;
  const items = useMemo(
    () => (more ? [...firstPage, ...more.items] : firstPage),
    [more, firstPage],
  );
  const hasMore = more ? more.lastPageFull : firstPage.length === PAGE;

  function loadMore() {
    const last = items[items.length - 1];
    if (!hasMore || !last) return;
    const page = repos.transactions.list(
      filter,
      { occurredAt: last.occurredAt, id: last.id },
      PAGE,
    );
    setExtra({
      key: pageKey,
      items: [...(more?.items ?? []), ...page],
      lastPageFull: page.length === PAGE,
    });
  }

  const sections = useMemo(() => {
    const groups = new Map<string, ListItem[]>();
    for (const it of items) {
      const key =
        groupBy === 'day'
          ? it.occurredOn
          : it.type === 'transfer'
            ? '__transfer'
            : (it.categoryId ?? '__none');
      groups.set(key, [...(groups.get(key) ?? []), it]);
    }
    return [...groups.entries()].map(([key, data]) => ({
      key,
      title:
        groupBy === 'day'
          ? f.date(key as LocalDate)
          : key === '__transfer'
            ? t('quickAdd.typeTransfer')
            : f.categoryName(categoryMap.get(key)),
      data,
    }));
  }, [items, groupBy, f, t, categoryMap]);

  const filtersActive =
    query !== '' || types !== 'all' || accountId || categoryId || tagId || range !== 'month';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <SectionList
        testID="transaction-list"
        sections={sections}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xs }}
        stickySectionHeadersEnabled={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={20}
        windowSize={11}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
            <TextField
              label={t('transactions.search')}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              testID="search"
            />
            <Segmented
              label={t('transactions.title')}
              value={types}
              onChange={setTypes}
              options={[
                { value: 'all', label: t('transactions.filterAll') },
                { value: 'expense', label: t('quickAdd.typeExpense') },
                { value: 'income', label: t('quickAdd.typeIncome') },
                { value: 'transfer', label: t('quickAdd.typeTransfer') },
              ]}
            />
            <Segmented
              label={t('quickAdd.date')}
              value={range}
              onChange={setRange}
              options={[
                { value: 'month', label: t('transactions.thisMonth') },
                { value: 'last', label: t('transactions.lastMonth') },
                { value: 'all', label: t('transactions.allTime') },
                ...(params.from ? [{ value: 'custom' as const, label: f.date(params.from) }] : []),
              ]}
            />
            <Row gap="sm" style={{ flexWrap: 'wrap' }}>
              {accounts.map((a) => (
                <Chip
                  key={a.id}
                  role="checkbox"
                  label={a.name}
                  icon={a.icon}
                  selected={accountId === a.id}
                  onPress={() => setAccountId(accountId === a.id ? null : a.id)}
                />
              ))}
            </Row>
            {categoryId ? (
              <Row gap="sm">
                <Chip
                  role="checkbox"
                  selected
                  label={f.categoryName(categoryMap.get(categoryId))}
                  onPress={() => setCategoryId(null)}
                />
              </Row>
            ) : null}
            {tags.length > 0 ? (
              <Row gap="sm" style={{ flexWrap: 'wrap' }}>
                {tags.map((tg) => (
                  <Chip
                    key={tg.id}
                    role="checkbox"
                    label={`#${tg.name}`}
                    selected={tagId === tg.id}
                    onPress={() => setTagId(tagId === tg.id ? null : tg.id)}
                  />
                ))}
              </Row>
            ) : null}
            <Segmented
              label={t('transactions.groupByDay')}
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'day', label: t('transactions.groupByDay') },
                { value: 'category', label: t('transactions.groupByCategory') },
              ]}
            />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text
            variant="bodyStrong"
            tone="muted"
            accessibilityRole="header"
            style={{ paddingTop: spacing.md }}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <TransactionRow
            item={item}
            f={f}
            today={today}
            categories={categoryMap}
            accounts={accountMap}
            onPress={() => onOpen(item.id)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title={t('transactions.emptyTitle')}
            body={t('transactions.emptyBody')}
            action={
              filtersActive
                ? {
                    label: t('transactions.clearFilters'),
                    onPress: () => {
                      setQuery('');
                      setTypes('all');
                      setAccountId(null);
                      setCategoryId(null);
                      setTagId(null);
                      setRange('all');
                    },
                  }
                : undefined
            }
          />
        }
        ListFooterComponent={
          hasMore ? (
            <Button label={t('transactions.loadMore')} variant="secondary" onPress={loadMore} />
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}
