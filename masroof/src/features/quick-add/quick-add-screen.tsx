import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, AppState, Image, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  addDays,
  fromParts,
  isScheduled,
  MAX_ATTACHMENTS,
  money,
  validateTransaction,
  type CurrencyCode,
  type EditScope,
  type LocalDate,
  type TransactionType,
} from '@/domain';
import {
  Banner,
  Button,
  Chip,
  Keypad,
  Row,
  Segmented,
  Stack,
  Text,
  TextField,
  spacing,
  useTheme,
  type KeypadKey,
} from '@/ui';

import { useFormat, tDynamic } from '../session/use-format';
import { useLedger, useSession } from '../session/session';
import { useUndoStore } from '../undo/undo-store';
import {
  derive,
  displayExpression,
  initialState,
  reducer,
  reviveDraft,
  stateFromTransaction,
  type FormState,
} from './form-state';

const DRAFT_KEY = 'quick-add';

export type QuickAddProps = Readonly<{
  editId?: string | null;
  initialType?: TransactionType | null;
  initialDate?: LocalDate | null;
  onDone: (savedId: string) => void;
  onCancel: () => void;
}>;

export function QuickAddScreen({
  editId,
  initialType,
  initialDate,
  onDone,
  onCancel,
}: QuickAddProps) {
  const session = useSession();
  const { repos, settings, timeZone } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const showSnack = useUndoStore((s) => s.show);
  const today = repos.today();

  const accounts = useLedger((r) => r.accounts.list(), []);
  const defaultAccount =
    accounts.find((a) => a.id === settings.lastAccountId)?.id ?? accounts[0]?.id ?? null;

  // Initial state, computed once: the transaction being edited, else a fresh
  // draft (J2: kept 10 minutes), else a blank form.
  const [boot] = useState(() => {
    if (editId) {
      const d = repos.transactions.get(editId);
      if (d) return { state: stateFromTransaction(d, today, f.decimalSeparator), restored: false };
    } else {
      const draft = reviveDraft(repos.drafts.load(DRAFT_KEY));
      if (draft) return { state: draft, restored: true };
    }
    const blank: FormState = initialState({
      today,
      accountId: defaultAccount,
      type: initialType ?? 'expense',
      occurredOn: initialDate,
    });
    return { state: blank, restored: false };
  });
  const [state, dispatch] = useReducer(reducer, boot.state);
  const [draftRestored, setDraftRestored] = useState(boot.restored);
  const [photoDenied, setPhotoDenied] = useState<null | { canAskAgain: boolean }>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Persist the draft when the app goes to the background mid-entry.
  useEffect(() => {
    if (editId) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && stateRef.current.expression !== '') {
        repos.drafts.save(DRAFT_KEY, stateRef.current);
      }
    });
    return () => sub.remove();
  }, [editId, repos]);

  const account = accounts.find((a) => a.id === state.accountId);
  const toAccount = accounts.find((a) => a.id === state.toAccountId);
  const currency = (account?.currency as CurrencyCode | undefined) ?? null;
  const toCurrency = (toAccount?.currency as CurrencyCode | undefined) ?? null;

  // Prefill the rate for foreign-currency accounts from the last one used.
  useEffect(() => {
    if (!currency || currency === settings.baseCurrency || state.rateText) return;
    const known = repos.fx.latest(currency, settings.baseCurrency);
    if (known) dispatch({ kind: 'field', field: 'rateText', value: known });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, settings.baseCurrency]);

  const derived = derive(state, {
    currency,
    toCurrency,
    baseCurrency: settings.baseCurrency,
    decimalSeparator: f.decimalSeparator,
    today,
    timeZone,
    now: Date.now(),
  });

  const existing = useMemo(
    () => (editId ? repos.transactions.get(editId) : undefined),
    [editId, repos],
  );
  const validation = useMemo(() => {
    if (!derived.input) return null;
    return validateTransaction(derived.input, {
      baseCurrency: settings.baseCurrency,
      today,
      account: (id) => {
        const facts = repos.accounts.facts(id, today);
        return facts && existing?.accountId === id
          ? { ...facts, balanceMinor: facts.balanceMinor + existing.amountMinor }
          : facts;
      },
      category: (id) => repos.categories.facts(id),
      existingCategoryIds: new Set(existing?.splits.map((s) => s.categoryId)),
    });
  }, [derived.input, existing, repos, settings.baseCurrency, today]);

  const blocking = [
    ...derived.issues.filter((i) => i !== 'empty' && i !== derived.amountError),
    ...(validation?.errors ?? []),
  ];
  const canSave = !!derived.input && (validation?.errors.length ?? 1) === 0 && !saving;

  const kind = state.type === 'transfer' ? null : state.type;
  const categories = useLedger((r) => (kind ? r.categories.list(kind) : []), [kind]);
  const recent = useLedger((r) => (kind ? r.categories.recentIds(kind) : []), [kind]);
  const orderedCategories = useMemo(() => {
    const rank = new Map(recent.map((id, i) => [id, i]));
    return [...categories].sort(
      (a, b) => (rank.get(a.id) ?? 1e6 + a.sortOrder) - (rank.get(b.id) ?? 1e6 + b.sortOrder),
    );
  }, [categories, recent]);

  const press = (key: KeypadKey) => {
    if (!currency) return;
    dispatch({ kind: 'key', key, decimalSeparator: f.decimalSeparator, currency });
  };

  async function attachPending(txId: string, uris: readonly string[]) {
    for (const uri of uris) {
      const r = await session.attachments.add(txId, uri);
      if (r.status !== 'ok') {
        showSnack(tDynamic(t, `photos.${r.status}`), {
          label: t('photos.retry'),
          onPress: () => void attachPending(txId, [uri]).then(session.bump),
        });
        return;
      }
    }
  }

  function fail(errors: readonly string[]) {
    setSaving(false);
    Alert.alert(t('quickAdd.titleNew'), errors.map((e) => f.error(e)).join('\n'));
  }

  function commit(scope?: EditScope) {
    const input = derived.input;
    if (!input) return;
    setSaving(true);
    let id: string;
    if (editId) {
      const r = repos.transactions.update(editId, input, scope);
      if (!r.ok) return fail(r.error);
      id = editId;
    } else {
      const r = repos.transactions.create(input);
      if (!r.ok) return fail(r.error);
      id = r.value.id;
    }
    repos.drafts.clear(DRAFT_KEY);
    session.haptic('success');
    session.bump();
    const photos = state.pendingPhotos;
    onDone(id);
    if (photos.length > 0) void attachPending(id, photos).then(session.bump);
  }

  function save() {
    if (!canSave) return;
    if (existing?.recurringRuleId) {
      Alert.alert(t('quickAdd.scopeTitle'), t('quickAdd.scopeBody'), [
        { text: t('quickAdd.scopeThis'), onPress: () => commit('this_only') },
        { text: t('quickAdd.scopeFuture'), onPress: () => commit('this_and_future') },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
      return;
    }
    commit();
  }

  function toggleSplit() {
    if (!currency) return;
    if (!state.splitMode) {
      dispatch({ kind: 'splitOn', currency });
      return;
    }
    const preview = reducer(state, {
      kind: 'splitOff',
      currency,
      decimalSeparator: f.decimalSeparator,
    });
    const target = categories.find((c) => c.id === preview.categoryId);
    Alert.alert(
      t('quickAdd.splitCollapseTitle'),
      t('quickAdd.splitCollapseBody', { category: f.categoryName(target) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.done'),
          onPress: () =>
            dispatch({ kind: 'splitOff', currency, decimalSeparator: f.decimalSeparator }),
        },
      ],
    );
  }

  async function addPhoto(source: 'library' | 'camera') {
    const existingCount = (existing?.attachments.length ?? 0) + state.pendingPhotos.length;
    if (existingCount >= MAX_ATTACHMENTS) {
      showSnack(t('photos.limit_reached'));
      return;
    }
    const r = await session.pickImage(source);
    if (r.status === 'picked') {
      setPhotoDenied(null);
      dispatch({ kind: 'photoAdd', uri: r.uri });
    } else if (r.status === 'denied') {
      setPhotoDenied({ canAskAgain: r.canAskAgain });
    }
  }

  const fmtAmount = (minor: number, c: CurrencyCode | null) =>
    c ? f.money(money(minor, c)) : String(minor);

  const yesterday = addDays(today, -1);
  const isCustomDate = state.occurredOn !== today && state.occurredOn !== yesterday;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        testID="quick-add"
      >
        {draftRestored ? (
          <Banner
            message={t('quickAdd.draftRestored')}
            action={{
              label: t('quickAdd.discardDraft'),
              onPress: () => {
                repos.drafts.clear(DRAFT_KEY);
                dispatch({
                  kind: 'replace',
                  state: initialState({
                    today,
                    accountId: defaultAccount,
                    type: initialType ?? 'expense',
                  }),
                });
                setDraftRestored(false);
              },
            }}
          />
        ) : null}

        <Segmented
          label={t('quickAdd.titleNew')}
          value={state.type}
          options={[
            { value: 'expense', label: t('quickAdd.typeExpense') },
            { value: 'income', label: t('quickAdd.typeIncome') },
            { value: 'transfer', label: t('quickAdd.typeTransfer') },
          ]}
          onChange={(type) => dispatch({ kind: 'type', type })}
        />

        {/* Amount */}
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {t('quickAdd.amount')} {currency ? `(${currency})` : ''}
          </Text>
          <Text
            variant="display"
            testID="amount-display"
            accessibilityRole="text"
            accessibilityLabel={`${t('quickAdd.amount')}: ${state.expression || '0'}`}
            style={{ direction: 'ltr', textAlign: 'auto' }}
          >
            {displayExpression(state.expression, f.arabicDigits) || f.digits(0)}
          </Text>
          {derived.amount &&
          state.expression.length > 0 &&
          /[+\-*/]/.test(state.expression.slice(1)) ? (
            <Text tone="muted" testID="amount-result">
              {t('quickAdd.amountResult', { amount: f.money(derived.amount) })}
            </Text>
          ) : null}
          {derived.amountError ? (
            <Text tone="danger" accessibilityRole="alert" testID="amount-error">
              {f.error(derived.amountError)}
              {state.lastValidMinor !== null && derived.amountError === 'invalid'
                ? ` (${fmtAmount(state.lastValidMinor, currency)})`
                : ''}
            </Text>
          ) : null}
        </Stack>

        {/* Accounts */}
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {state.type === 'transfer' ? t('quickAdd.fromAccount') : t('quickAdd.account')}
          </Text>
          <Row gap="sm" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
            {accounts.map((a) => (
              <Chip
                key={a.id}
                label={`${a.name} · ${a.currency}`}
                icon={a.icon}
                selected={a.id === state.accountId}
                onPress={() => dispatch({ kind: 'account', id: a.id })}
              />
            ))}
          </Row>
        </Stack>

        {state.type === 'transfer' ? (
          <Stack gap="sm">
            <Text variant="caption" tone="muted">
              {t('quickAdd.toAccount')}
            </Text>
            <Row gap="sm" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
              {accounts
                .filter((a) => a.id !== state.accountId)
                .map((a) => (
                  <Chip
                    key={a.id}
                    label={`${a.name} · ${a.currency}`}
                    icon={a.icon}
                    selected={a.id === state.toAccountId}
                    onPress={() => dispatch({ kind: 'toAccount', id: a.id })}
                  />
                ))}
            </Row>
            {toCurrency && currency && toCurrency !== currency ? (
              <>
                <TextField
                  label={t('quickAdd.toAmount', { currency: toCurrency })}
                  keyboardType="decimal-pad"
                  value={state.toAmountText}
                  onChangeText={(text) => dispatch({ kind: 'toAmount', text })}
                  testID="to-amount"
                />
                {derived.impliedRate ? (
                  <Text tone="muted" testID="implied-rate">
                    {t('quickAdd.impliedRate', {
                      from: currency,
                      rate: derived.impliedRate,
                      to: toCurrency,
                    })}
                  </Text>
                ) : null}
              </>
            ) : null}
          </Stack>
        ) : (
          <Stack gap="sm">
            <Row gap="sm" style={{ justifyContent: 'space-between' }}>
              <Text variant="caption" tone="muted">
                {t('quickAdd.category')}
              </Text>
              <Chip
                role="checkbox"
                label={t('quickAdd.splitOn')}
                selected={state.splitMode}
                onPress={toggleSplit}
                testID="split-toggle"
              />
            </Row>
            {state.splitMode ? (
              <Stack gap="md" testID="split-editor">
                {state.splits.map((row, i) => (
                  <Stack key={row.key} gap="xs">
                    <Row gap="xs" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
                      {orderedCategories.map((c) => (
                        <Chip
                          key={c.id}
                          label={f.categoryName(c)}
                          icon={c.icon}
                          selected={row.categoryId === c.id}
                          onPress={() =>
                            dispatch({ kind: 'splitCategory', key: row.key, id: c.id })
                          }
                        />
                      ))}
                    </Row>
                    <Row gap="sm">
                      <View style={{ flex: 1 }}>
                        <TextField
                          label={t('quickAdd.splitRowAmount', { n: f.digits(i + 1) })}
                          keyboardType="decimal-pad"
                          value={row.text}
                          onChangeText={(text) =>
                            dispatch({ kind: 'splitAmount', key: row.key, text })
                          }
                          testID={`split-amount-${i}`}
                        />
                      </View>
                      {state.splits.length > 1 ? (
                        <Button
                          label={t('common.remove')}
                          variant="secondary"
                          onPress={() => dispatch({ kind: 'splitRemove', key: row.key })}
                        />
                      ) : null}
                    </Row>
                  </Stack>
                ))}
                <Button
                  label={t('quickAdd.splitAddRow')}
                  variant="secondary"
                  onPress={() => dispatch({ kind: 'splitAdd' })}
                />
                {derived.remaining ? (
                  <Text
                    testID="split-remaining"
                    accessibilityLiveRegion="polite"
                    tone={derived.remaining.amountMinor === 0 ? 'income' : 'warning'}
                    variant="bodyStrong"
                  >
                    {derived.remaining.amountMinor === 0
                      ? `✓ ${t('quickAdd.splitBalanced')}`
                      : derived.remaining.amountMinor > 0
                        ? t('quickAdd.splitRemaining', { amount: f.money(derived.remaining) })
                        : t('quickAdd.splitOver', {
                            amount: f.money({
                              ...derived.remaining,
                              amountMinor: -derived.remaining.amountMinor,
                            }),
                          })}
                  </Text>
                ) : null}
              </Stack>
            ) : (
              <Row
                gap="sm"
                style={{ flexWrap: 'wrap' }}
                accessibilityRole="radiogroup"
                testID="category-grid"
              >
                {orderedCategories.map((c) => (
                  <Chip
                    key={c.id}
                    label={f.categoryName(c)}
                    icon={c.icon}
                    selected={state.categoryId === c.id}
                    onPress={() => dispatch({ kind: 'category', id: c.id })}
                  />
                ))}
              </Row>
            )}
          </Stack>
        )}

        {derived.needsRate && currency ? (
          <TextField
            label={t('quickAdd.rateLabel', { from: currency, to: settings.baseCurrency })}
            keyboardType="decimal-pad"
            value={state.rateText}
            onChangeText={(value) => dispatch({ kind: 'field', field: 'rateText', value })}
            testID="rate"
          />
        ) : null}

        {/* Date */}
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            {t('quickAdd.date')}
          </Text>
          <Row gap="sm" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
            <Chip
              label={t('quickAdd.today')}
              selected={state.occurredOn === today}
              onPress={() => dispatch({ kind: 'date', date: today })}
            />
            <Chip
              label={t('quickAdd.yesterday')}
              selected={state.occurredOn === yesterday}
              onPress={() => dispatch({ kind: 'date', date: yesterday })}
            />
            <Chip
              label={isCustomDate ? f.date(state.occurredOn) : t('quickAdd.pickDate')}
              selected={isCustomDate}
              onPress={() => setShowPicker(true)}
            />
          </Row>
          {showPicker ? (
            <DateTimePicker
              value={new Date(`${state.occurredOn}T12:00:00`)}
              mode="date"
              onChange={(event, date) => {
                setShowPicker(false);
                if (event.type === 'set' && date) {
                  dispatch({
                    kind: 'date',
                    date: fromParts(date.getFullYear(), date.getMonth() + 1, date.getDate()),
                  });
                }
              }}
            />
          ) : null}
          {isScheduled(state.occurredOn, today) ? (
            <Text tone="warning" testID="scheduled-label">
              ⏱ {t('home.scheduled')}
            </Text>
          ) : null}
        </Stack>

        <TextField
          label={`${t('quickAdd.note')} (${t('common.optional')})`}
          value={state.note}
          onChangeText={(value) => dispatch({ kind: 'field', field: 'note', value })}
          multiline
          maxLength={1000}
        />
        {state.type !== 'transfer' ? (
          <TextField
            label={`${t('quickAdd.payee')} (${t('common.optional')})`}
            value={state.payee}
            onChangeText={(value) => dispatch({ kind: 'field', field: 'payee', value })}
          />
        ) : null}
        <TextField
          label={`${t('quickAdd.tags')} (${t('common.optional')})`}
          value={state.tags}
          onChangeText={(value) => dispatch({ kind: 'field', field: 'tags', value })}
          autoCapitalize="none"
        />

        {/* Photos */}
        <Stack gap="sm">
          <Text variant="caption" tone="muted">
            {t('quickAdd.photoCount', {
              count: f.digits((existing?.attachments.length ?? 0) + state.pendingPhotos.length),
              max: f.digits(MAX_ATTACHMENTS),
            })}
          </Text>
          <Row gap="sm" style={{ flexWrap: 'wrap' }}>
            {state.pendingPhotos.map((uri, i) => (
              <Image
                key={uri}
                source={{ uri }}
                accessibilityLabel={t('photos.photoLabel', { n: f.digits(i + 1) })}
                style={{ width: 64, height: 64, borderRadius: 8 }}
              />
            ))}
          </Row>
          <Row gap="sm" style={{ flexWrap: 'wrap' }}>
            <Button
              label={t('quickAdd.addPhoto')}
              variant="secondary"
              onPress={() => void addPhoto('library')}
            />
            <Button
              label={t('quickAdd.takePhoto')}
              variant="secondary"
              onPress={() => void addPhoto('camera')}
            />
          </Row>
          {photoDenied ? (
            <Banner
              tone="warning"
              testID="photo-denied"
              message={`${t('photos.deniedTitle')}. ${t('photos.deniedBody')}`}
              action={
                photoDenied.canAskAgain
                  ? undefined
                  : { label: t('common.openSettings'), onPress: session.openSystemSettings }
              }
            />
          ) : null}
        </Stack>

        {(validation?.warnings ?? []).map((w) => (
          <Banner key={w} tone="warning" message={f.warning(w)} testID={`warning-${w}`} />
        ))}
      </ScrollView>

      <View
        style={{
          padding: spacing.md,
          gap: spacing.sm,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        {blocking.length > 0 && state.expression !== '' ? (
          <Text tone="danger" variant="caption" testID="blocking-issue">
            {f.error(blocking[0] as string)}
          </Text>
        ) : null}
        <Keypad
          onKey={press}
          decimalSeparator={f.decimalSeparator}
          arabicDigits={f.arabicDigits}
          labels={{
            plus: t('quickAdd.keypad.plus'),
            minus: t('quickAdd.keypad.minus'),
            times: t('quickAdd.keypad.times'),
            divide: t('quickAdd.keypad.divide'),
            decimal: t('quickAdd.keypad.decimal'),
            backspace: t('quickAdd.keypad.backspace'),
            clear: t('quickAdd.keypad.clear'),
          }}
        />
        <Row gap="sm">
          <Button
            label={t('common.cancel')}
            variant="secondary"
            onPress={onCancel}
            style={{ flex: 1 }}
          />
          <Button
            label={t('common.save')}
            disabled={!canSave}
            onPress={save}
            style={{ flex: 2 }}
            testID="save"
          />
        </Row>
      </View>
    </SafeAreaView>
  );
}
