import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { localDateOf } from '@/domain';
import type { BackupPreview, OpenedBackup } from '@/services/backup/backup-service';
import { MIN_PASSPHRASE } from '@/services/backup/backup-service';
import { Banner, Button, Card, LoadingState, spacing, Text, TextField, useTheme } from '@/ui';

import { useSession } from '../session/session';
import { tDynamic, useFormat } from '../session/use-format';
import { useUndoStore } from '../undo/undo-store';

/** Let the spinner render before the (synchronous, CPU-heavy) Argon2id step. */
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

/** J9: encrypted backup to the share sheet; restore with preview and explicit replace. */
export function BackupScreen() {
  const session = useSession();
  const { backup, settings } = session;
  const f = useFormat();
  const { t } = f;
  const { colors } = useTheme();
  const toast = useUndoStore((s) => s.show);

  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const backupError = (code: string) => tDynamic(t, `backup.errors.${code}`);
  const dateOf = (ms: number) => f.date(localDateOf(ms, session.timeZone));
  const createProblem =
    pass.length > 0 && pass.length < MIN_PASSPHRASE
      ? t('backup.tooShort')
      : pass2.length > 0 && pass2 !== pass
        ? t('backup.mismatch')
        : null;

  async function create() {
    setError(null);
    setBusy(t('backup.working'));
    await nextFrame();
    const r = await backup.create(pass);
    if (!r.ok) {
      setBusy(null);
      return setError(backupError(r.error));
    }
    try {
      const day = localDateOf(Date.now(), session.timeZone);
      await session.shareBytes(`masroof-${day}.masroof`, r.value, 'application/octet-stream');
      session.updateSetting('lastBackupAt', Date.now());
      setPass('');
      setPass2('');
      toast(t('backup.created'));
    } finally {
      setBusy(null);
    }
  }

  async function pick() {
    setRestoreError(null);
    const picked = await session.pickFile(['application/octet-stream', '*/*']);
    if (!picked) return;
    const r = backup.inspect(picked.bytes);
    if (!r.ok) {
      setFile(null);
      setPreview(null);
      return setRestoreError(backupError(r.error));
    }
    setFile(picked.bytes);
    setPreview(r.value);
  }

  async function openIt() {
    if (!file) return;
    setRestoreError(null);
    setBusy(t('backup.opening'));
    await nextFrame();
    const r = backup.open(file, restorePass);
    setBusy(null);
    if (!r.ok) return setRestoreError(backupError(r.error));
    if (backup.hasUserData()) {
      Alert.alert(t('backup.replaceTitle'), t('backup.replaceBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('backup.replace'),
          style: 'destructive',
          onPress: () => void apply(r.value, true),
        },
      ]);
    } else {
      await apply(r.value, false);
    }
  }

  async function apply(o: OpenedBackup, confirmReplace: boolean) {
    setBusy(t('backup.opening'));
    await nextFrame();
    const r = await backup.restore(o, { confirmReplace });
    setBusy(null);
    if (!r.ok) return setRestoreError(backupError(r.error));
    Alert.alert(t('backup.restored'));
    session.reloadApp();
  }

  if (busy) return <LoadingState label={busy} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        testID="backup-screen"
      >
        <Card>
          <Text variant="title" accessibilityRole="header">
            {t('backup.createTitle')}
          </Text>
          <Text tone="muted">{t('backup.createBody')}</Text>
          <Text variant="caption" testID="last-backup">
            {settings.lastBackupAt
              ? t('backup.lastBackup', { date: dateOf(settings.lastBackupAt) })
              : t('backup.neverBackedUp')}
          </Text>
          <TextField
            label={t('backup.passphrase')}
            value={pass}
            onChangeText={setPass}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            testID="backup-pass"
          />
          <TextField
            label={t('backup.passphraseConfirm')}
            value={pass2}
            onChangeText={setPass2}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            error={createProblem}
            testID="backup-pass2"
          />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button
            label={t('backup.create')}
            disabled={pass.length < MIN_PASSPHRASE || pass !== pass2}
            onPress={() => void create()}
            testID="backup-create"
          />
        </Card>

        <Card>
          <Text variant="title" accessibilityRole="header">
            {t('backup.restoreTitle')}
          </Text>
          <Text tone="muted">{t('backup.restoreBody')}</Text>
          <Button
            label={t('backup.pick')}
            variant="secondary"
            onPress={() => void pick()}
            testID="backup-pick"
          />
          {preview ? (
            <>
              <Text testID="backup-preview">
                {t('backup.preview', {
                  date: dateOf(preview.createdAt),
                  transactions: f.digits(preview.counts.transactions ?? 0),
                  accounts: f.digits(preview.counts.accounts ?? 0),
                  photos: f.digits(preview.attachments),
                })}
              </Text>
              <TextField
                label={t('backup.passphrase')}
                value={restorePass}
                onChangeText={setRestorePass}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                testID="restore-pass"
              />
              <Button
                label={t('backup.open')}
                disabled={restorePass.length === 0}
                onPress={() => void openIt()}
                testID="restore-open"
              />
            </>
          ) : null}
          {restoreError ? (
            <Banner tone="danger" message={restoreError} testID="restore-error" />
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
