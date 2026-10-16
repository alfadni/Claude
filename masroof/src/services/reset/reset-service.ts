/**
 * Reset data (J11). Destructive, so it is gated by an exact typed word and
 * runs in a safe order: if the database file cannot be removed, nothing else
 * is touched (deleting keys first would strand an undecryptable DB).
 */
export const RESET_WORD = 'RESET';

export type ResetPorts = Readonly<{
  closeDatabase: () => void;
  deleteDatabaseFile: () => void;
  /** Deletes the attachments and backups directories in the app sandbox. */
  deleteAppFiles: () => void;
  deleteDatabaseKey: () => Promise<void>;
  wipeLock: () => Promise<void>;
}>;

export type ResetResult = 'done' | 'confirmation_mismatch' | 'database_delete_failed';

export async function resetAllData(ports: ResetPorts, typed: string): Promise<ResetResult> {
  if (typed.trim() !== RESET_WORD) return 'confirmation_mismatch';
  ports.closeDatabase();
  try {
    ports.deleteDatabaseFile();
  } catch {
    return 'database_delete_failed';
  }
  try {
    ports.deleteAppFiles();
  } catch {
    // orphan sweep on next launch removes anything left behind
  }
  await ports.deleteDatabaseKey();
  await ports.wipeLock();
  return 'done';
}
