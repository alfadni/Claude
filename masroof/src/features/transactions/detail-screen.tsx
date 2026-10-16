import { useEffect, useState } from 'react';
import { Image, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MAX_ATTACHMENTS, money, type CurrencyCode, type LocalDate } from '@/domain';
import {
  AmountText,
  Banner,
  Button,
  Card,
  EmptyState,
  Row,
  spacing,
  Stack,
  Text,
  useTheme,
} from '@/ui';

import { useLedger, useSession } from '../session/session';
import { tDynamic, useFormat } from '../session/use-format';
import { useUndoStore } from '../undo/undo-store';

export function TransactionDetailScreen({
  id,
  onEdit,
  onDeleted,
  onRepeat,
  onOpenRule,
}: {
  id: string;
  onEdit: (id: string) => void;
  onDeleted: () => void;
  /** "Repeat…": make this transaction recurring (ADR-013). */
  onRepeat?: (id: string) => void;
  onOpenRule?: (ruleId: string) => void;
}) {
  const session = useSession();
  const { repos, settings } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const showSnack = useUndoStore((s) => s.show);
  const tx = useLedger((r) => r.transactions.get(id), [id]);
  const categories = useLedger((r) => r.categories.list(undefined, { includeArchived: true }), []);
  const accounts = useLedger((r) => r.accounts.list({ includeArchived: true }), []);
  const [images, setImages] = useState<Record<string, string | 'error'>>({});
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    for (const a of tx?.attachments ?? []) {
      if (images[a.id]) continue;
      session.attachments
        .readAsDataUri(a)
        .then((uri) => !cancelled && setImages((m) => ({ ...m, [a.id]: uri })))
        .catch(() => !cancelled && setImages((m) => ({ ...m, [a.id]: 'error' })));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.attachments.length]);

  if (!tx || tx.deletedAt !== null) {
    return <EmptyState title={t('errors.not_found')} />;
  }

  const currency = tx.currency as CurrencyCode;
  const kindLabel =
    tx.type === 'income'
      ? 'amount.income'
      : tx.type === 'expense'
        ? 'amount.expense'
        : 'amount.transfer';
  const account = accounts.find((a) => a.id === tx.accountId);
  const toAccount = accounts.find((a) => a.id === tx.toAccountId);

  function remove() {
    const r = repos.transactions.delete(id);
    if (!r.ok) return;
    session.haptic('warning');
    session.bump();
    showSnack(t('detail.deleted'), {
      label: t('common.undo'),
      onPress: () => {
        repos.transactions.restore(id);
        session.bump();
      },
    });
    onDeleted();
  }

  async function addPhoto() {
    const picked = await session.pickImage('library');
    if (picked.status === 'denied') {
      setPhotoError(`${t('photos.deniedTitle')}. ${t('photos.deniedBody')}`);
      return;
    }
    if (picked.status !== 'picked') return;
    const r = await session.attachments.add(id, picked.uri);
    setPhotoError(r.status === 'ok' ? null : tDynamic(t, `photos.${r.status}`));
    session.bump();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        testID="transaction-detail"
      >
        <Card>
          <AmountText
            variant="display"
            money={money(tx.amountMinor, currency)}
            kind={tx.type}
            spokenLabel={(a) => t(kindLabel, { amount: a })}
            testID="detail-amount"
          />
          {currency !== settings.baseCurrency ? (
            <Text tone="muted">
              {t('detail.baseAmount', {
                currency: settings.baseCurrency,
                amount: f.money(money(tx.baseAmountMinor, settings.baseCurrency)),
              })}
            </Text>
          ) : null}
          {tx.type === 'transfer' &&
          tx.toAmountMinor &&
          tx.toCurrency &&
          tx.toCurrency !== tx.currency ? (
            <Text>→ {f.money(money(tx.toAmountMinor, tx.toCurrency as CurrencyCode))}</Text>
          ) : null}
        </Card>
        <Card>
          <Text variant="caption" tone="muted">
            {t('detail.account')}
          </Text>
          <Text>
            {tx.type === 'transfer'
              ? t('transactions.transfer', { from: account?.name ?? '', to: toAccount?.name ?? '' })
              : account?.name}
          </Text>
          <Text variant="caption" tone="muted">
            {t('detail.date')}
          </Text>
          <Text>{f.date(tx.occurredOn as LocalDate)}</Text>
          {tx.splits.length > 0 ? (
            <>
              <Text variant="caption" tone="muted">
                {t('detail.categories')}
              </Text>
              {tx.splits.map((s) => {
                const c = categories.find((x) => x.id === s.categoryId);
                return (
                  <Row key={s.id} gap="sm" style={{ justifyContent: 'space-between' }}>
                    <Text>
                      {c?.icon} {f.categoryName(c)}
                    </Text>
                    <Text>{f.money(money(s.amountMinor, currency))}</Text>
                  </Row>
                );
              })}
            </>
          ) : null}
          {tx.payeeName ? (
            <>
              <Text variant="caption" tone="muted">
                {t('detail.payee')}
              </Text>
              <Text>{tx.payeeName}</Text>
            </>
          ) : null}
          {tx.note ? (
            <>
              <Text variant="caption" tone="muted">
                {t('detail.note')}
              </Text>
              <Text>{tx.note}</Text>
            </>
          ) : null}
          {tx.tags.length > 0 ? (
            <>
              <Text variant="caption" tone="muted">
                {t('detail.tags')}
              </Text>
              <Text>{tx.tags.map((x) => `#${x.name}`).join(' ')}</Text>
            </>
          ) : null}
        </Card>
        <Card>
          <Text variant="caption" tone="muted">
            {t('quickAdd.photoCount', {
              count: f.digits(tx.attachments.length),
              max: f.digits(MAX_ATTACHMENTS),
            })}
          </Text>
          <Row gap="sm" style={{ flexWrap: 'wrap' }}>
            {tx.attachments.map((a, i) => {
              const src = images[a.id];
              return src && src !== 'error' ? (
                <Image
                  key={a.id}
                  source={{ uri: src }}
                  accessibilityLabel={t('photos.photoLabel', { n: f.digits(i + 1) })}
                  style={{ width: 96, height: 96, borderRadius: 8 }}
                />
              ) : src === 'error' ? (
                <Text key={a.id} tone="danger">
                  {t('photos.unreadable')}
                </Text>
              ) : null;
            })}
          </Row>
          {photoError ? (
            <Banner
              tone="warning"
              message={photoError}
              action={{ label: t('common.openSettings'), onPress: session.openSystemSettings }}
            />
          ) : null}
          {tx.attachments.length < MAX_ATTACHMENTS ? (
            <Button
              label={t('quickAdd.addPhoto')}
              variant="secondary"
              onPress={() => void addPhoto()}
            />
          ) : null}
        </Card>
        <Stack gap="sm">
          <Button label={t('common.edit')} onPress={() => onEdit(id)} testID="edit" />
          {tx.recurringRuleId && onOpenRule ? (
            <Button
              label={t('planning.viewRule')}
              variant="secondary"
              onPress={() => onOpenRule(tx.recurringRuleId as string)}
              testID="view-rule"
            />
          ) : !tx.recurringRuleId && tx.status === 'posted' && onRepeat ? (
            <Button
              label={t('planning.repeat')}
              variant="secondary"
              onPress={() => onRepeat(id)}
              testID="repeat"
            />
          ) : null}
          <Button label={t('common.delete')} variant="danger" onPress={remove} testID="delete" />
        </Stack>
      </ScrollView>
    </SafeAreaView>
  );
}
