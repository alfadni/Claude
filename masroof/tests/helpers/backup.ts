import Database from 'better-sqlite3';

import { createAttachmentService, type FileStore } from '@/services/attachments/attachment-service';
import { createBackupService } from '@/services/backup/backup-service';
import { deriveKey } from '@/services/crypto/aead';

import { createLedger, type Ledger } from './ledger';
import { rnd, TEST_KDF } from './security';
import { betterSqliteExecutor } from './sqlite';

export class MemoryFiles implements FileStore {
  files = new Map<string, Uint8Array>();
  failWritesMatching: RegExp | null = null;
  async write(path: string, bytes: Uint8Array) {
    if (this.failWritesMatching?.test(path)) throw new Error('EIO');
    this.files.set(path, bytes);
  }
  async read(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error(`ENOENT ${path}`);
    return f;
  }
  move(from: string, to: string) {
    const f = this.files.get(from);
    if (!f) throw new Error('ENOENT');
    this.files.delete(from);
    this.files.set(to, f);
  }
  delete(path: string) {
    this.files.delete(path);
  }
  list(dir: string) {
    return [...this.files.keys()]
      .filter((p) => p.startsWith(`${dir}/`))
      .map((p) => p.slice(dir.length + 1));
  }
  availableBytes() {
    return 1e9;
  }
}

export type Device = {
  ledger: Ledger;
  files: MemoryFiles;
  key: Uint8Array;
  attachments: ReturnType<typeof createAttachmentService>;
  backup: ReturnType<typeof createBackupService>;
};

/** A "phone": its own ledger, file system and attachment key. */
export function createDevice(ledger: Ledger = createLedger()): Device {
  const files = new MemoryFiles();
  const key = deriveKey(rnd(32), 'attachments/v1');
  const attachments = createAttachmentService({
    repo: ledger.repos.attachments,
    files,
    compress: async (uri) => new TextEncoder().encode(`jpeg-bytes-of:${uri}`),
    key,
    randomBytes: rnd,
    newId: ledger.newId,
  });
  const backup = createBackupService({
    sql: ledger.sql,
    attachments: ledger.repos.attachments,
    files,
    attachmentKey: key,
    randomBytes: rnd,
    now: () => ledger.clock.now,
    appVersion: '0.2.0-test',
    openScratch: () => betterSqliteExecutor(new Database(':memory:')),
    kdf: TEST_KDF,
  });
  return { ledger, files, key, attachments, backup };
}

/** Order-independent fingerprint of every backed-up table. */
export function fingerprint(l: Ledger): Record<string, string> {
  const tables = [
    'settings',
    'accounts',
    'categories',
    'payees',
    'tags',
    'transactions',
    'transaction_splits',
    'attachments',
    'transaction_tags',
    'fx_rates',
  ];
  return Object.fromEntries(
    tables.map((t) => {
      const rows = l.sql.all<Record<string, unknown>>(`SELECT * FROM ${t}`).map((r) => {
        const { file_path: _ignored, ...rest } = r as { file_path?: unknown };
        return JSON.stringify(rest, Object.keys(rest).sort());
      });
      return [t, `${rows.length}:${rows.sort().join('|')}`];
    }),
  );
}
