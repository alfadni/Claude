import { useMemo, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { localDateOf } from '@/domain';
import type { CategoryMapping, DateOrder, ImportOptions } from '@/services/csv/import';
import { Banner, Button, Card, Chip, Row, Segmented, spacing, Stack, Text, useTheme } from '@/ui';

import { useLedger, useSession } from '../session/session';
import { tDynamic, useFormat } from '../session/use-format';
import { useUndoStore } from '../undo/undo-store';

/** CSV export (plain text, warned) and import with preview, mapping and duplicate skipping (J9). */
export function CsvScreen() {
  const session = useSession();
  const { repos, csv } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const toast = useUndoStore((s) => s.show);
  const [text, setText] = useState<string | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy');
  const [mapping, setMapping] = useState<Record<string, string | 'create'>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const categories = useLedger((r) => r.categories.list(), []);

  const options: ImportOptions | null = useMemo(() => {
    const account = repos.accounts.list()[0];
    return account
      ? {
          dateOrder,
          decimalSeparator: f.decimalSeparator,
          defaultAccountId: account.id,
          timeZone: session.timeZone,
        }
      : null;
  }, [repos, dateOrder, f.decimalSeparator, session.timeZone]);

  const preview = useMemo(
    () =>
      text !== null && options ? csv.preview(text, options, mapping as CategoryMapping) : null,
    [text, options, mapping, csv],
  );
  const err = (code: string, o?: Record<string, unknown>) => tDynamic(t, `csv.errors.${code}`, o);

  function exportCsv() {
    Alert.alert(t('csv.exportTitle'), t('csv.exportWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('csv.exportConfirm'),
        onPress: () =>
          void session.shareBytes(
            `masroof-${localDateOf(Date.now(), session.timeZone)}.csv`,
            session.exportCsv(f.categoryName),
            'text/csv',
          ),
      },
    ]);
  }

  async function pick() {
    setFileError(null);
    const picked = await session.pickFile([
      'text/csv',
      'text/comma-separated-values',
      'text/plain',
      '*/*',
    ]);
    if (!picked) return;
    try {
      setText(new TextDecoder('utf-8', { fatal: true }).decode(picked.bytes));
      setMapping({});
    } catch {
      setFileError(err('empty'));
    }
  }

  function commit() {
    if (text === null || !options) return;
    const r = csv.commit(text, options, mapping as CategoryMapping);
    if (!r.ok) {
      const e = r.error;
      return setFileError(
        typeof e === 'string' ? err(e) : err('commit_failed', { line: f.digits(e.line) }),
      );
    }
    session.bump();
    toast(t('csv.imported', { count: f.digits(r.value.imported) }));
    setText(null);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        testID="csv-screen"
      >
        <Card>
          <Text variant="title" accessibilityRole="header">
            {t('csv.exportTitle')}
          </Text>
          <Banner tone="warning" message={t('csv.exportWarning')} />
          <Button label={t('csv.export')} onPress={exportCsv} testID="csv-export" />
        </Card>

        <Card>
          <Text variant="title" accessibilityRole="header">
            {t('csv.importTitle')}
          </Text>
          <Text tone="muted">{t('csv.importBody')}</Text>
          <Text variant="caption">{t('csv.dateOrder')}</Text>
          <Segmented
            label={t('csv.dateOrder')}
            value={dateOrder}
            onChange={setDateOrder}
            options={[
              { value: 'dmy', label: '31/12/2026' },
              { value: 'mdy', label: '12/31/2026' },
              { value: 'ymd', label: '2026-12-31' },
            ]}
          />
          <Button
            label={t('csv.pick')}
            variant="secondary"
            onPress={() => void pick()}
            testID="csv-pick"
          />
          {fileError ? <Banner tone="danger" message={fileError} testID="csv-error" /> : null}
          {preview && !preview.ok ? (
            <Banner tone="danger" message={err(preview.error)} testID="csv-error" />
          ) : null}
          {preview?.ok ? (
            <Stack gap="md" testID="csv-preview">
              <Text variant="bodyStrong">
                {t('csv.preview', {
                  ok: f.digits(preview.value.counts.ok),
                  duplicate: f.digits(preview.value.counts.duplicate),
                  error: f.digits(preview.value.counts.error),
                })}
              </Text>
              {preview.value.unknownCategories.length > 0 ? (
                <Stack gap="sm">
                  <Text variant="bodyStrong">{t('csv.mapTitle')}</Text>
                  {preview.value.unknownCategories.map((u) => (
                    <Stack key={`${u.kind}:${u.name}`} gap="xs">
                      <Text>“{u.name}”</Text>
                      <Row gap="xs" style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
                        <Chip
                          label={t('csv.mapCreate', { name: u.name })}
                          selected={mapping[u.name] === 'create'}
                          onPress={() => setMapping((m) => ({ ...m, [u.name]: 'create' }))}
                          testID={`map-create-${u.name}`}
                        />
                        {categories
                          .filter((c) => c.kind === u.kind)
                          .map((c) => (
                            <Chip
                              key={c.id}
                              label={f.categoryName(c)}
                              icon={c.icon}
                              selected={mapping[u.name] === c.id}
                              onPress={() => setMapping((m) => ({ ...m, [u.name]: c.id }))}
                            />
                          ))}
                      </Row>
                    </Stack>
                  ))}
                </Stack>
              ) : null}
              {preview.value.rows
                .filter((r) => r.status === 'error')
                .slice(0, 20)
                .map((r) => (
                  <Text key={r.lines.join('-')} tone="danger" variant="caption">
                    {t('csv.row', { line: f.digits(r.lines[0] ?? 0) })}:{' '}
                    {r.errors.map((e) => err(e)).join(', ')}
                  </Text>
                ))}
              <Button
                label={t('csv.import', { count: f.digits(preview.value.counts.ok) })}
                disabled={preview.value.counts.ok === 0}
                onPress={commit}
                testID="csv-commit"
              />
            </Stack>
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
