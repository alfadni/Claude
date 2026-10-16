import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PendingItem } from '@/data/repositories/transactions-repository';
import {
  addDays,
  maxDate,
  money,
  occurrencesBetween,
  parseAmount,
  toDecimalString,
  type CurrencyCode,
  type LocalDate,
} from '@/domain';
import {
  AmountText,
  Banner,
  Button,
  Card,
  EmptyState,
  ListRow,
  Row,
  spacing,
  Stack,
  Text,
  TextField,
  useTheme,
} from '@/ui';

import { useLedger, useSession } from '../session/session';
import { useFormat } from '../session/use-format';
import { ruleLabel } from './planning-texts';

const COMING_UP_DAYS = 30;

/**
 * The Upcoming inbox (J5): confirm / change / skip pending occurrences,
 * review a large back-fill, fix rules that could not post, and preview the
 * next 30 days. Works fully without notification permission.
 */
export function UpcomingScreen({
  onOpenRule,
  onManageRules,
}: {
  onOpenRule: (ruleId: string) => void;
  onManageRules: () => void;
}) {
  const session = useSession();
  const { repos } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const today = repos.today();
  const pending = useLedger((r) => r.transactions.listPending(), []);
  const { rules } = useLedger((r) => r.recurring.list(), []);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const label = (ruleId: string) => {
    const rule = ruleById.get(ruleId);
    return rule ? ruleLabel(t, repos, rule) : '';
  };

  function after(r: { ok: boolean; error?: unknown }) {
    if (!r.ok) {
      const code = Array.isArray(r.error) ? String(r.error[0]) : String(r.error);
      setError(f.error(code));
      return;
    }
    setError(null);
    session.haptic('success');
    session.bump();
  }

  function confirm(item: PendingItem, amountText?: string) {
    if (amountText === undefined) return after(repos.transactions.confirmPending(item.id));
    const parsed = parseAmount(amountText, item.currency, { decimalSeparator: f.decimalSeparator });
    if (!parsed.ok || parsed.value.amountMinor <= 0) return setError(f.error('amount_invalid'));
    setEditing(null);
    after(repos.transactions.confirmPending(item.id, parsed.value.amountMinor));
  }

  // Back-filled auto_post occurrences wait here for review (> 3 missed, J5).
  const review = new Map<string, PendingItem[]>();
  for (const p of pending) {
    if (p.mode !== 'auto_post') continue;
    review.set(p.ruleId, [...(review.get(p.ruleId) ?? []), p]);
  }
  const attention = rules.filter((r) => r.lastError);
  const horizon = addDays(today, COMING_UP_DAYS);
  const comingUp = rules
    .filter((r) => !r.isPaused && r.nextOn)
    .flatMap((r) =>
      occurrencesBetween(r.schedule, maxDate(r.nextOn as LocalDate, addDays(today, 1)), horizon, {
        alreadyGenerated: r.occurrenceCount,
        limit: 10,
      }).map((date) => ({ rule: r, date })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        testID="upcoming"
      >
        {session.notificationPermission === 'denied' ? (
          <Banner
            tone="info"
            message={t('planning.notificationsOff')}
            action={{ label: t('planning.openSettings'), onPress: session.openSystemSettings }}
            testID="notifications-off"
          />
        ) : null}
        {error ? <Banner tone="danger" message={error} testID="upcoming-error" /> : null}

        {attention.map((r) => (
          <Banner
            key={r.id}
            tone="warning"
            message={t('planning.ruleError', {
              label: ruleLabel(t, repos, r),
              reason: f.error(String(r.lastError).split(',')[0] ?? ''),
            })}
            action={{ label: t('planning.fixRule'), onPress: () => onOpenRule(r.id) }}
            testID={`rule-error-${r.id}`}
          />
        ))}

        {[...review.entries()].map(([ruleId, items]) => (
          <Card key={ruleId} testID={`review-${ruleId}`}>
            <Text variant="bodyStrong">{t('planning.reviewTitle')}</Text>
            <Text>
              {t('planning.reviewBody', { count: f.digits(items.length), label: label(ruleId) })}
            </Text>
            <Button
              label={t('planning.postAll', { count: f.digits(items.length) })}
              onPress={() => {
                for (const item of items) {
                  const r = repos.transactions.confirmPending(item.id);
                  if (!r.ok) return after(r);
                }
                after({ ok: true });
              }}
              testID={`post-all-${ruleId}`}
            />
          </Card>
        ))}

        {pending.length === 0 && attention.length === 0 ? (
          <EmptyState title={t('planning.upcomingTitle')} body={t('planning.upcomingEmpty')} />
        ) : null}

        {pending.map((item) => {
          const remind = item.mode === 'remind_only';
          const currency = item.currency as CurrencyCode;
          const isEditing = editing?.id === item.id;
          return (
            <Card key={item.id} testID={`pending-${item.id}`}>
              <Row gap="sm" style={{ justifyContent: 'space-between' }}>
                <Stack gap="xxs" style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {label(item.ruleId)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t('planning.due', { date: f.date(item.occurredOn) })}
                  </Text>
                </Stack>
                <AmountText
                  money={money(item.amountMinor, currency)}
                  kind={item.type}
                  spokenLabel={(a) => t(`amount.${item.type}`, { amount: a })}
                />
              </Row>
              {isEditing ? (
                <Row gap="sm" align="flex-end">
                  <TextField
                    label={t('planning.editAmount')}
                    value={editing.text}
                    onChangeText={(text) => setEditing({ id: item.id, text })}
                    keyboardType="decimal-pad"
                    style={{ flex: 1 }}
                    testID={`amount-${item.id}`}
                  />
                  <Button
                    label={t('common.save')}
                    onPress={() => confirm(item, editing.text)}
                    testID={`save-amount-${item.id}`}
                  />
                </Row>
              ) : null}
              <Row gap="sm" style={{ flexWrap: 'wrap' }}>
                <Button
                  label={remind ? t('planning.record') : t('planning.confirm')}
                  onPress={() => confirm(item)}
                  testID={`confirm-${item.id}`}
                />
                {item.splitCount <= 1 && !isEditing ? (
                  <Button
                    label={t('planning.editAmount')}
                    variant="secondary"
                    onPress={() =>
                      setEditing({
                        id: item.id,
                        text: toDecimalString(money(item.amountMinor, currency)),
                      })
                    }
                    testID={`edit-${item.id}`}
                  />
                ) : null}
                <Button
                  label={remind ? t('planning.dismiss') : t('planning.skip')}
                  variant="secondary"
                  onPress={() => after(repos.transactions.skipPending(item.id))}
                  testID={`skip-${item.id}`}
                />
              </Row>
            </Card>
          );
        })}

        <Card>
          <Text variant="bodyStrong">{t('planning.comingUp')}</Text>
          {comingUp.length === 0 ? (
            <Text tone="muted">{t('planning.nothingComingUp')}</Text>
          ) : (
            comingUp.map(({ rule, date }) => (
              <ListRow
                key={`${rule.id}:${date}`}
                title={ruleLabel(t, repos, rule)}
                subtitle={f.date(date)}
                onPress={() => onOpenRule(rule.id)}
                trailing={
                  <Text>
                    {f.money(
                      money(
                        rule.template.amountMinor,
                        (repos.accounts.get(rule.template.accountId)?.currency ??
                          session.settings.baseCurrency) as CurrencyCode,
                      ),
                    )}
                  </Text>
                }
              />
            ))
          )}
        </Card>
        <Button
          label={t('planning.rulesTitle')}
          variant="secondary"
          onPress={onManageRules}
          testID="manage-rules"
        />
      </ScrollView>
    </SafeAreaView>
  );
}
