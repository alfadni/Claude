import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { deleteDatabaseSync, openDatabaseSync } from 'expo-sqlite';

import type { SqlExecutor } from '@/data/sql-executor';

import { DB_FILE, executor, expoSecretStore } from '../db/expo-connection';
import { DB_KEY_NAME } from '../db/open-database';

/**
 * Hand a file to the OS share sheet (Files, iCloud Drive, Google Drive…).
 * The temporary copy is deleted afterwards: a CSV export is plain text.
 */
export async function shareBytes(
  fileName: string,
  bytes: Uint8Array | string,
  mimeType: string,
): Promise<void> {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, fileName);
  if (file.exists) file.delete();
  file.create();
  await file.write(bytes);
  try {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: fileName });
  } finally {
    if (file.exists) file.delete();
  }
}

export type PickedFile = Readonly<{ name: string; bytes: Uint8Array }>;

export async function pickFile(mimeTypes: string[]): Promise<PickedFile | null> {
  const r = await File.pickFileAsync({ mimeTypes });
  if (r.canceled || !r.result) return null;
  const file = r.result;
  try {
    return { name: file.name, bytes: await file.bytes() };
  } finally {
    // The picker copies into our cache; don't keep a second copy around.
    if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
  }
}

/** Unencrypted in-memory DB for migrating an old backup forward; never touches disk. */
export function openScratch(): SqlExecutor {
  return executor(openDatabaseSync(':memory:'));
}

export const expoResetPorts = (closeDatabase: () => void) => ({
  closeDatabase,
  deleteDatabaseFile: () => deleteDatabaseSync(DB_FILE),
  deleteAppFiles: () => {
    for (const name of ['attachments', 'backups']) {
      const d = new Directory(Paths.document, name);
      if (d.exists) d.delete();
    }
  },
  deleteDatabaseKey: () => expoSecretStore.delete(DB_KEY_NAME),
});
