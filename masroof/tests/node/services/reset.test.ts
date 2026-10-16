import { resetAllData, type ResetPorts } from '@/services/reset/reset-service';

function ports(over: Partial<ResetPorts> = {}) {
  const calls: string[] = [];
  const p: ResetPorts = {
    closeDatabase: () => void calls.push('close'),
    deleteDatabaseFile: () => void calls.push('db'),
    deleteAppFiles: () => void calls.push('files'),
    deleteDatabaseKey: async () => void calls.push('key'),
    wipeLock: async () => void calls.push('lock'),
    cancelNotifications: async () => void calls.push('notifications'),
    ...over,
  };
  return { p, calls };
}

describe('J11 reset data', () => {
  it('requires typing RESET exactly; anything else changes nothing', async () => {
    for (const typed of ['', 'reset', 'RESE', 'ريست']) {
      const { p, calls } = ports();
      expect(await resetAllData(p, typed)).toBe('confirmation_mismatch');
      expect(calls).toEqual([]);
    }
  });

  it('wipes database, files and keys, in a safe order', async () => {
    const { p, calls } = ports();
    expect(await resetAllData(p, ' RESET ')).toBe('done');
    expect(calls).toEqual(['close', 'db', 'files', 'key', 'lock', 'notifications']);
  });

  it('scheduled reminders are cancelled; a failure there still completes the reset', async () => {
    const { p, calls } = ports({
      cancelNotifications: async () => {
        throw new Error('unavailable');
      },
    });
    expect(await resetAllData(p, 'RESET')).toBe('done');
    expect(calls).toEqual(['close', 'db', 'files', 'key', 'lock']);
  });

  it('if the database cannot be deleted, keys are kept (no stranded encrypted DB)', async () => {
    const { p, calls } = ports({
      deleteDatabaseFile: () => {
        throw new Error('EBUSY');
      },
    });
    expect(await resetAllData(p, 'RESET')).toBe('database_delete_failed');
    expect(calls).toEqual(['close']);
  });

  it('a failure deleting files does not stop the key wipe', async () => {
    const { p, calls } = ports({
      deleteAppFiles: () => {
        throw new Error('EIO');
      },
    });
    expect(await resetAllData(p, 'RESET')).toBe('done');
    expect(calls).toEqual(['close', 'db', 'key', 'lock', 'notifications']);
  });
});
