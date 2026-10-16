import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CategoryKind } from '@/domain';
import { Banner, Button, ListRow, Row, Segmented, spacing, Text, TextField, useTheme } from '@/ui';

import { useLedger, useSession } from '../session/session';
import { useFormat } from '../session/use-format';

/** Manage categories: add, rename, reorder, archive. Never hard-delete (spec 5.14). */
export function CategoriesScreen() {
  const session = useSession();
  const { repos } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const all = useLedger((r) => r.categories.list(kind, { includeArchived: true }), [kind]);
  const active = all.filter((c) => !c.isArchived);
  const archived = all.filter((c) => c.isArchived);

  const done = () => {
    setError(null);
    session.bump();
  };

  function move(index: number, delta: number) {
    const ids = active.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    repos.categories.reorder(kind, ids);
    done();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
        testID="categories"
      >
        <Segmented
          label={t('categories.title')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: t('categories.expense') },
            { value: 'income', label: t('categories.income') },
          ]}
        />
        <Row gap="sm" align="flex-end">
          <TextField
            label={t('categories.newName')}
            value={newName}
            onChangeText={setNewName}
            maxLength={40}
            style={{ minWidth: 180 }}
            testID="new-category"
          />
          <Button
            label={t('common.add')}
            onPress={() => {
              const r = repos.categories.create({ name: newName, kind });
              if (!r.ok) return setError(f.error(r.error));
              setNewName('');
              done();
            }}
          />
        </Row>
        {error ? <Banner tone="danger" message={error} /> : null}
        {active.map((c, i) =>
          editing?.id === c.id ? (
            <Row key={c.id} gap="sm" align="flex-end">
              <TextField
                label={t('categories.rename')}
                value={editing.name}
                onChangeText={(name) => setEditing({ id: c.id, name })}
                maxLength={40}
              />
              <Button
                label={t('common.save')}
                onPress={() => {
                  const r = repos.categories.rename(c.id, editing.name);
                  if (!r.ok) return setError(f.error(r.error));
                  setEditing(null);
                  done();
                }}
              />
            </Row>
          ) : (
            <ListRow
              key={c.id}
              icon={c.icon}
              title={f.categoryName(c)}
              onPress={() => setEditing({ id: c.id, name: f.categoryName(c) })}
              accessibilityLabel={`${f.categoryName(c)}, ${t('categories.rename')}`}
              trailing={
                <Row gap="xs">
                  <Button
                    label="↑"
                    accessibilityLabel={t('common.moveUp')}
                    variant="secondary"
                    onPress={() => move(i, -1)}
                    disabled={i === 0}
                  />
                  <Button
                    label="↓"
                    accessibilityLabel={t('common.moveDown')}
                    variant="secondary"
                    onPress={() => move(i, 1)}
                    disabled={i === active.length - 1}
                  />
                  <Button
                    label={t('common.archive')}
                    variant="secondary"
                    onPress={() => (repos.categories.setArchived(c.id, true), done())}
                  />
                </Row>
              }
            />
          ),
        )}
        {archived.length > 0 ? (
          <Text variant="bodyStrong" tone="muted" accessibilityRole="header">
            {t('categories.archivedSection')}
          </Text>
        ) : null}
        {archived.map((c) => (
          <ListRow
            key={c.id}
            icon={c.icon}
            title={f.categoryName(c)}
            trailing={
              <Button
                label={t('common.unarchive')}
                variant="secondary"
                onPress={() => (repos.categories.setArchived(c.id, false), done())}
              />
            }
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
