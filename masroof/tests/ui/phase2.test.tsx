import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { BackupScreen } from '@/features/backup/backup-screen';
import { BootErrorScreen } from '@/features/boot/boot-error-screen';
import { CsvScreen } from '@/features/data/csv-screen';
import { HomeScreen } from '@/features/home/home-screen';
import { LockScreen } from '@/features/lock/lock-screen';
import { useLockStore } from '@/features/lock/lock-store';
import { ResetScreen } from '@/features/reset/reset-screen';
import { SecurityScreen } from '@/features/security/security-screen';

import { createLedger, must } from '../helpers/ledger';
import { createTestSession, renderWithSession } from './ledger-session';
import { renderWithProviders } from './render';

jest.mock('@react-native-community/datetimepicker', () => () => null);

async function typePin(pin: string) {
  for (const d of pin) await fireEvent.press(screen.getByRole('button', { name: d }));
}

async function withPin(pin = '2580', biometrics = false) {
  const ts = createTestSession();
  await ts.session.lock.setPin(pin);
  if (biometrics) await ts.session.lock.enableBiometrics();
  await ts.session.refreshSecurity();
  return ts;
}

describe('J8 lock screen', () => {
  it('correct PIN unlocks', async () => {
    const ts = await withPin();
    const onUnlocked = jest.fn();
    await renderWithSession(<LockScreen onUnlocked={onUnlocked} onReset={jest.fn()} />, ts);
    await typePin('2580');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('lock-submit'));
    });
    expect(onUnlocked).toHaveBeenCalled();
  });

  it('PIN digits are never shown or read aloud', async () => {
    const ts = await withPin();
    await renderWithSession(<LockScreen onUnlocked={jest.fn()} onReset={jest.fn()} />, ts);
    await typePin('25');
    expect(screen.getByTestId('pin-pad-dots').props.accessibilityLabel).toBe(
      'PIN digit 2 of 6 entered',
    );
    expect(screen.queryByText('25')).toBeNull();
  });

  it('5 wrong PINs → cool-down banner and keypad disabled; no wipe', async () => {
    const ts = await withPin();
    await renderWithSession(<LockScreen onUnlocked={jest.fn()} onReset={jest.fn()} />, ts);
    for (let i = 0; i < 4; i++) {
      await typePin('0000');
      await act(async () => {
        await fireEvent.press(screen.getByTestId('lock-submit'));
      });
    }
    expect(screen.getByTestId('lock-message')).toHaveTextContent(
      /Wrong PIN\. 1 attempts left before a pause\./,
    );
    await typePin('0000');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('lock-submit'));
    });
    expect(screen.getByTestId('lock-cooldown')).toHaveTextContent(
      /Too many attempts\. Try again in 30 s\./,
    );
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    expect((await ts.session.lock.status()).pinSet).toBe(true);
    expect(ts.ledger.repos.accounts.list()).toHaveLength(2); // data untouched
  });

  it('biometrics: prompted on open and unlock', async () => {
    const ts = await withPin('2580', true);
    const onUnlocked = jest.fn();
    await act(async () => {
      await renderWithSession(<LockScreen onUnlocked={onUnlocked} onReset={jest.fn()} />, ts);
    });
    expect(onUnlocked).toHaveBeenCalled();
  });

  it('biometrics changed at OS level → explains, PIN required, biometric option removed', async () => {
    const ts = await withPin('2580', true);
    ts.vault.osInvalidate();
    const onUnlocked = jest.fn();
    await act(async () => {
      await renderWithSession(<LockScreen onUnlocked={onUnlocked} onReset={jest.fn()} />, ts);
    });
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(screen.getByTestId('lock-message')).toHaveTextContent(/fingerprints or face changed/);
    expect(ts.security.current.biometricsEnabled).toBe(false);
  });

  it('forgot PIN without biometrics: only reset + restore, clearly warned', async () => {
    const ts = await withPin();
    const onReset = jest.fn();
    await renderWithSession(<LockScreen onUnlocked={jest.fn()} onReset={onReset} />, ts);
    await fireEvent.press(screen.getByTestId('lock-forgot'));
    expect(screen.getByTestId('forgot-no-bio')).toHaveTextContent(
      /only way in is to reset the app and restore from a backup/,
    );
    await fireEvent.press(screen.getByTestId('forgot-reset'));
    expect(onReset).toHaveBeenCalled();
  });

  it('forgot PIN with biometrics: biometric unlock, then choose a new PIN', async () => {
    const ts = await withPin('2580', true);
    ts.vault.cancelNext = true; // dismiss the automatic prompt
    const onUnlocked = jest.fn();
    await act(async () => {
      await renderWithSession(<LockScreen onUnlocked={onUnlocked} onReset={jest.fn()} />, ts);
    });
    await fireEvent.press(screen.getByTestId('lock-forgot'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('forgot-biometric'));
    });
    expect(screen.getByTestId('pin-setup')).toBeOnTheScreen();
    for (let i = 0; i < 2; i++) {
      await typePin('7391');
      await fireEvent.press(screen.getByTestId('pin-continue'));
    }
    await act(async () => undefined);
    expect(onUnlocked).toHaveBeenCalled();
    expect(await ts.session.lock.verifyPin('7391')).toEqual({ status: 'ok' });
  });
});

describe('J8 auto-lock and privacy cover', () => {
  beforeEach(() => useLockStore.setState({ locked: false, covered: false, backgroundedAt: null }));

  it('locks after the timeout in the background; covers content while inactive', () => {
    const s = useLockStore.getState();
    s.onAppState('inactive', { lockEnabled: true, timeoutSeconds: 60, now: 0 });
    expect(useLockStore.getState().covered).toBe(true);
    s.onAppState('background', { lockEnabled: true, timeoutSeconds: 60, now: 1000 });
    s.onAppState('active', { lockEnabled: true, timeoutSeconds: 60, now: 30_000 });
    expect(useLockStore.getState()).toMatchObject({ covered: false, locked: false });
    s.onAppState('background', { lockEnabled: true, timeoutSeconds: 60, now: 40_000 });
    s.onAppState('active', { lockEnabled: true, timeoutSeconds: 60, now: 100_000 });
    expect(useLockStore.getState().locked).toBe(true);
  });

  it('never locks when no PIN is set', () => {
    const s = useLockStore.getState();
    s.onAppState('background', { lockEnabled: false, timeoutSeconds: 0, now: 0 });
    s.onAppState('active', { lockEnabled: false, timeoutSeconds: 0, now: 999_999 });
    expect(useLockStore.getState().locked).toBe(false);
  });
});

describe('J8 security settings', () => {
  it('set PIN (with weak-PIN warning), toggle biometrics, change timeout', async () => {
    const ts = createTestSession();
    const utils = await renderWithSession(<SecurityScreen onBackup={jest.fn()} />, ts);
    await fireEvent.press(screen.getByTestId('set-pin'));
    await typePin('1111');
    await fireEvent.press(screen.getByTestId('pin-continue'));
    expect(screen.getByTestId('pin-weak')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('pin-continue')); // keep anyway
    await typePin('1112');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('pin-continue'));
    });
    expect(screen.getByTestId('pin-mismatch')).toBeOnTheScreen(); // confirmation mismatch restarts
    await typePin('2580');
    await fireEvent.press(screen.getByTestId('pin-continue'));
    await typePin('2580');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('pin-continue'));
    });
    await utils.refresh();
    expect(ts.security.current.pinSet).toBe(true);
    expect(screen.getByTestId('forgot-warning')).toBeOnTheScreen(); // nudges a backup
    await act(async () => {
      await fireEvent.press(screen.getByTestId('biometrics-toggle'));
    });
    await utils.refresh();
    expect(ts.security.current.biometricsEnabled).toBe(true);
    await fireEvent.press(screen.getByRole('radio', { name: '5 min' }));
    expect(ts.session.settings.lockTimeoutSeconds).toBe(300);
  });

  it('turning the lock off requires the current PIN', async () => {
    const ts = await withPin();
    const utils = await renderWithSession(<SecurityScreen onBackup={jest.fn()} />, ts);
    await fireEvent.press(screen.getByTestId('turn-off'));
    await typePin('0000');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('verify-current'));
    });
    expect(ts.security.current.pinSet).toBe(true);
    await typePin('2580');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('verify-current'));
    });
    await utils.refresh();
    expect(ts.security.current.pinSet).toBe(false);
  });

  it('warns (does not block) on rooted/jailbroken devices; hides biometrics when unavailable', async () => {
    const ts = await withPin();
    ts.security.current = { ...ts.security.current, compromised: true, biometricsAvailable: false };
    await renderWithSession(<SecurityScreen onBackup={jest.fn()} />, ts);
    expect(screen.getByTestId('compromised')).toBeOnTheScreen();
    expect(screen.queryByTestId('biometrics-toggle')).toBeNull();
  });
});

describe('J9 backup screen', () => {
  const PASS = 'long enough passphrase';

  it('creates an encrypted backup, shares it and records the date', async () => {
    const ts = createTestSession();
    must(ts.ledger.repos.transactions.create(ts.ledger.expense()));
    await renderWithSession(<BackupScreen />, ts);
    expect(screen.getByTestId('last-backup')).toHaveTextContent('No backup yet');
    await fireEvent.changeText(screen.getByTestId('backup-pass'), 'short');
    expect(screen.getByTestId('backup-create')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('backup-pass'), PASS);
    await fireEvent.changeText(screen.getByTestId('backup-pass2'), `${PASS}x`);
    expect(screen.getByText('Passphrases do not match')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('backup-pass2'), PASS);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('backup-create'));
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(ts.share).toHaveBeenCalledWith(
      expect.stringMatching(/^masroof-\d{4}-\d{2}-\d{2}\.masroof$/),
      expect.any(Uint8Array),
      'application/octet-stream',
    );
    expect(ts.session.settings.lastBackupAt).not.toBeNull();
  });

  async function restoreFlow(passphrase: string, target = createTestSession()) {
    const source = createTestSession();
    must(source.ledger.repos.transactions.create(source.ledger.expense({ note: 'from backup' })));
    const file = must(await source.session.backup.create(PASS));
    target.pickFileMock.mockResolvedValueOnce({ name: 'b.masroof', bytes: file });
    await renderWithSession(<BackupScreen />, target);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('backup-pick'));
    });
    expect(screen.getByTestId('backup-preview')).toHaveTextContent(
      /1 transactions, 2 accounts, 0 photos/,
    );
    await fireEvent.changeText(screen.getByTestId('restore-pass'), passphrase);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('restore-open'));
      await new Promise((r) => setTimeout(r, 60));
    });
    return target;
  }

  it('wrong passphrase → clear error, nothing changed', async () => {
    const target = await restoreFlow('not the passphrase');
    expect(screen.getByTestId('restore-error')).toHaveTextContent(/Wrong passphrase/);
    expect(target.ledger.repos.transactions.list({}, null)).toEqual([]);
    expect(target.reload).not.toHaveBeenCalled();
  });

  it('restore over existing data asks to replace; cancel changes nothing; replace restores and restarts', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const target = createTestSession();
    must(target.ledger.repos.transactions.create(target.ledger.expense({ note: 'local only' })));
    alert.mockImplementationOnce((_t, _m, buttons) => buttons?.[0]?.onPress?.()); // Cancel
    await restoreFlow(PASS, target);
    expect(target.ledger.repos.transactions.list({}, null).map((x) => x.note)).toEqual([
      'local only',
    ]);

    alert.mockImplementationOnce((_t, _m, buttons) => buttons?.[1]?.onPress?.()); // Replace
    alert.mockImplementation(() => undefined);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('restore-open'));
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(alert).toHaveBeenCalledWith(
      'Replace current data?',
      expect.stringMatching(/safety backup/),
      expect.any(Array),
    );
    expect(target.ledger.repos.transactions.list({}, null).map((x) => x.note)).toEqual([
      'from backup',
    ]);
    expect(target.reload).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('a non-backup file is rejected with a clear message', async () => {
    const ts = createTestSession();
    ts.pickFileMock.mockResolvedValueOnce({
      name: 'x.csv',
      bytes: new TextEncoder().encode('a,b'),
    });
    await renderWithSession(<BackupScreen />, ts);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('backup-pick'));
    });
    expect(screen.getByTestId('restore-error')).toHaveTextContent(
      /This is not a Masroof backup file\./,
    );
  });
});

describe('J9 CSV screen', () => {
  it('export warns that the file is plain text before sharing', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    const ts = createTestSession();
    must(ts.ledger.repos.transactions.create(ts.ledger.expense()));
    await renderWithSession(<CsvScreen />, ts);
    await fireEvent.press(screen.getByTestId('csv-export'));
    expect(alert).toHaveBeenCalledWith(
      'Export transactions',
      expect.stringMatching(/NOT encrypted/),
      expect.any(Array),
    );
    expect(ts.share).toHaveBeenCalledWith(
      expect.stringMatching(/\.csv$/),
      expect.stringContaining('transaction_id,date'),
      'text/csv',
    );
    alert.mockRestore();
  });

  it('import: preview with counts and errors, map unknown category, then commit', async () => {
    const ts = createTestSession();
    const text =
      'date,amount,category,note\n15/10/2026,-5,Food,ok\n15/10/2026,-6,Gym,needs map\n31/02/2026,-1,Food,bad date\n';
    ts.pickFileMock.mockResolvedValueOnce({
      name: 'bank.csv',
      bytes: new TextEncoder().encode(text),
    });
    await renderWithSession(<CsvScreen />, ts);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('csv-pick'));
    });
    expect(screen.getByTestId('csv-preview')).toHaveTextContent(
      /Ready: 1 · Duplicates \(skipped\): 0 · Errors \(skipped\): 2/,
    );
    expect(screen.getByText(/Line 4: Date not recognised/)).toBeOnTheScreen();
    expect(ts.ledger.repos.transactions.list({}, null)).toEqual([]); // nothing until confirm
    await fireEvent.press(screen.getByTestId('map-create-Gym'));
    expect(screen.getByTestId('csv-preview')).toHaveTextContent(/Ready: 2/);
    await fireEvent.press(screen.getByTestId('csv-commit'));
    expect(ts.ledger.repos.transactions.list({}, null)).toHaveLength(2);
  });
});

describe('J11 reset', () => {
  it('disabled until RESET is typed; offers backup first; cancel changes nothing', async () => {
    const reset = jest.fn(async () => 'done' as const);
    const onBackup = jest.fn();
    const onCancel = jest.fn();
    const onDone = jest.fn();
    await renderWithProviders(
      <ResetScreen reset={reset} onBackup={onBackup} onDone={onDone} onCancel={onCancel} />,
    );
    expect(screen.getByTestId('reset-confirm')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('reset-backup-first'));
    expect(onBackup).toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('reset-input'), 'reset');
    expect(screen.getByTestId('reset-confirm')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('reset-cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('reset-input'), 'RESET');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('reset-confirm'));
    });
    expect(reset).toHaveBeenCalledWith('RESET');
    expect(onDone).toHaveBeenCalled();
  });

  it('a failed reset says nothing changed', async () => {
    await renderWithProviders(
      <ResetScreen
        reset={async () => 'database_delete_failed'}
        onDone={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('reset-input'), 'RESET');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('reset-confirm'));
    });
    expect(
      screen.getByText('The data could not be erased. Nothing was changed.'),
    ).toBeOnTheScreen();
  });

  it('"key lost" boot error offers reset + restore', async () => {
    const onReset = jest.fn();
    await renderWithProviders(
      <BootErrorScreen kind="key_lost" onRetry={jest.fn()} onReset={onReset} />,
    );
    await fireEvent.press(screen.getByTestId('boot-reset'));
    expect(onReset).toHaveBeenCalled();
    await renderWithProviders(
      <BootErrorScreen kind="newer_schema" onRetry={jest.fn()} onReset={onReset} />,
    );
    expect(screen.queryByTestId('boot-reset')).toBeNull();
  });
});

describe('backup reminder', () => {
  it('shows on Home when there is data and no recent backup', async () => {
    const ts = createTestSession({ ledger: createLedger() });
    must(ts.ledger.repos.transactions.create(ts.ledger.expense()));
    const onBackup = jest.fn();
    const nav = {
      onAdd: jest.fn(),
      onDay: jest.fn(),
      onCategory: jest.fn(),
      onAllTransactions: jest.fn(),
      onSettings: jest.fn(),
      onAccounts: jest.fn(),
      onBackup,
    };
    const utils = await renderWithSession(<HomeScreen nav={nav} />, ts);
    await fireEvent.press(screen.getByRole('button', { name: 'Make a backup' }));
    expect(onBackup).toHaveBeenCalled();
    ts.session.updateSetting('lastBackupAt', Date.now());
    await utils.refresh();
    expect(screen.queryByTestId('backup-reminder')).toBeNull();
  });
});
