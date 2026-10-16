import type { AttachmentsRepository } from '@/data/repositories/attachments-repository';
import { MIGRATIONS, SCHEMA_VERSION, currentVersion, migrate } from '@/data/migrations';
import type { SqlExecutor, SqlValue } from '@/data/sql-executor';
import { err, ok, type Result } from '@/domain';

import type { FileStore } from '../attachments/attachment-service';
import { ATTACHMENT_DIR } from '../attachments/attachment-service';
import { bytesToHex, hexToBytes, open, seal, sha256Hex, type RandomBytes } from '../crypto/aead';
import { BACKUP_KDF, deriveFromSecret, type KdfParams } from '../crypto/kdf';
import {
  decodeBackup,
  encodeBackup,
  FrameType,
  readHeader,
  type BackupHeader,
  type Frame,
} from './container';
import { BACKUP_TABLES, type BackupTable } from './tables';

export const MIN_PASSPHRASE = 10;

type TableDump = { columns: string[]; rows: SqlValue[][] };
type DbPayload = { schemaVersion: number; tables: Partial<Record<BackupTable, TableDump>> };

export type InspectError = 'not_a_backup' | 'unsupported_format' | 'corrupt' | 'newer_schema';
export type OpenError = InspectError | 'wrong_passphrase';
export type RestoreError = 'needs_confirmation' | 'restore_failed' | 'passphrase_too_short';

export type BackupPreview = Readonly<{
  createdAt: number;
  schemaVersion: number;
  counts: Readonly<Record<string, number>>;
  attachments: number;
}>;

/** A fully decrypted and verified backup, held in memory until the user confirms. */
export type OpenedBackup = Readonly<{
  header: BackupHeader;
  payload: DbPayload;
  attachments: ReadonlyMap<string, Uint8Array>;
  passphrase: string;
}>;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isValue = (v: unknown): v is SqlValue =>
  v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

/**
 * Encrypted backup and restore (J9).
 * Rules: verify everything before writing anything; never trust names or paths
 * from the file; take an automatic safety backup before replacing data.
 */
export function createBackupService(deps: {
  sql: SqlExecutor;
  attachments: AttachmentsRepository;
  files: FileStore;
  attachmentKey: Uint8Array;
  randomBytes: RandomBytes;
  now: () => number;
  appVersion: string;
  /** Empty in-memory SQLite used to migrate old backups forward. */
  openScratch: () => SqlExecutor;
  kdf?: KdfParams;
}) {
  const kdf = deps.kdf ?? BACKUP_KDF;

  function columnsOf(sql: SqlExecutor, table: BackupTable): string[] {
    return sql.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
  }

  function dump(sql: SqlExecutor): DbPayload {
    const tables: DbPayload['tables'] = {};
    for (const t of BACKUP_TABLES) {
      const columns = columnsOf(sql, t);
      if (columns.length === 0) continue;
      const rows = sql
        .all<Record<string, SqlValue>>(`SELECT * FROM ${t}`)
        .map((r) => columns.map((c) => r[c] ?? null));
      tables[t] = { columns, rows };
    }
    return { schemaVersion: currentVersion(sql), tables };
  }

  function hasUserData(): boolean {
    return (
      deps.sql.all('SELECT 1 FROM transactions LIMIT 1').length > 0 ||
      deps.sql.all('SELECT 1 FROM accounts LIMIT 1').length > 0
    );
  }

  async function create(passphrase: string): Promise<Result<Uint8Array, 'passphrase_too_short'>> {
    if (passphrase.length < MIN_PASSPHRASE) return err('passphrase_too_short');
    const payload = dump(deps.sql);
    const salt = deps.randomBytes(16);
    const key = deriveFromSecret(passphrase, salt, kdf);
    const frames: Frame[] = [{ type: FrameType.Db, json: JSON.stringify(payload) }];
    // Attachments travel decrypted inside the backup's own encryption.
    for (const a of deps.sql.all<{ id: string; file_path: string }>(
      'SELECT id, file_path FROM attachments',
    )) {
      const sealed = await deps.files.read(a.file_path);
      frames.push({
        type: FrameType.Attachment,
        id: a.id,
        bytes: open(deps.attachmentKey, sealed, a.id),
      });
    }
    const counts = Object.fromEntries(
      Object.entries(payload.tables).map(([t, d]) => [t, d?.rows.length ?? 0]),
    );
    const header: BackupHeader = {
      format: 1,
      schemaVersion: payload.schemaVersion,
      appVersion: deps.appVersion,
      createdAt: deps.now(),
      kdf: { ...kdf, salt: bytesToHex(salt) },
      counts,
      attachments: frames.length - 1,
    };
    return ok(encodeBackup({ header, key, frames, randomBytes: deps.randomBytes }));
  }

  function inspect(file: Uint8Array): Result<BackupPreview, InspectError> {
    const h = readHeader(file);
    if (!h.ok) return err(h.error);
    if (h.header.schemaVersion > SCHEMA_VERSION) return err('newer_schema');
    const { createdAt, schemaVersion, counts, attachments } = h.header;
    return ok({ createdAt, schemaVersion, counts, attachments });
  }

  /** Decrypt and verify every byte; returns nothing partial. */
  function openBackup(file: Uint8Array, passphrase: string): Result<OpenedBackup, OpenError> {
    const pre = inspect(file);
    if (!pre.ok) return pre;
    const h = readHeader(file);
    if (!h.ok) return err(h.error);
    let key: Uint8Array;
    try {
      key = deriveFromSecret(passphrase, hexToBytes(h.header.kdf.salt), h.header.kdf);
    } catch {
      return err('corrupt'); // out-of-range KDF params in a crafted header
    }
    const decoded = decodeBackup(file, key);
    if (!decoded.ok) return err(decoded.error);

    const dbFrames = decoded.frames.filter((f) => f.type === FrameType.Db);
    if (dbFrames.length !== 1) return err('corrupt');
    let payload: DbPayload;
    try {
      payload = JSON.parse((dbFrames[0] as { json: string }).json) as DbPayload;
    } catch {
      return err('corrupt');
    }
    if (payload.schemaVersion !== h.header.schemaVersion) return err('corrupt');

    // Shape + counts + values.
    for (const [name, dumpT] of Object.entries(payload.tables ?? {})) {
      if (!(BACKUP_TABLES as readonly string[]).includes(name) || !dumpT) return err('corrupt');
      if (!Array.isArray(dumpT.columns) || !Array.isArray(dumpT.rows)) return err('corrupt');
      if (dumpT.rows.length !== (h.header.counts[name] ?? -1)) return err('corrupt');
      for (const row of dumpT.rows) {
        if (!Array.isArray(row) || row.length !== dumpT.columns.length || !row.every(isValue))
          return err('corrupt');
      }
    }

    // Attachments: ids well-formed, one per row, checksums match.
    const attachments = new Map<string, Uint8Array>();
    for (const f of decoded.frames) {
      if (f.type !== FrameType.Attachment) continue;
      if (!ID.test(f.id) || attachments.has(f.id)) return err('corrupt');
      attachments.set(f.id, f.bytes);
    }
    const att = payload.tables.attachments;
    if (attachments.size !== h.header.attachments || (att?.rows.length ?? 0) !== attachments.size) {
      return err('corrupt');
    }
    if (att) {
      const idIdx = att.columns.indexOf('id');
      const shaIdx = att.columns.indexOf('sha256');
      for (const row of att.rows) {
        const bytes = attachments.get(String(row[idIdx]));
        if (!bytes || sha256Hex(bytes) !== row[shaIdx]) return err('corrupt');
      }
    }
    return ok({ header: h.header, payload, attachments, passphrase });
  }

  /** Bring an older backup's rows up to the current schema in a scratch DB. */
  function migratedTables(payload: DbPayload): Map<BackupTable, TableDump> {
    const scratch = deps.openScratch();
    migrate(scratch, MIGRATIONS.slice(0, payload.schemaVersion));
    scratch.exec('PRAGMA foreign_keys = OFF');
    insertAll(scratch, payload.tables);
    migrate(scratch);
    const out = new Map<BackupTable, TableDump>();
    const current = dump(scratch);
    for (const t of BACKUP_TABLES) {
      const d = current.tables[t];
      if (d) out.set(t, d);
    }
    return out;
  }

  /** Insert rows; columns are intersected with the real table (never trusted from the file). */
  function insertAll(sql: SqlExecutor, tables: DbPayload['tables'] | Map<BackupTable, TableDump>) {
    const get = (t: BackupTable) => (tables instanceof Map ? tables.get(t) : tables[t]);
    for (const t of BACKUP_TABLES) {
      const d = get(t);
      if (!d || d.rows.length === 0) continue;
      const real = new Set(columnsOf(sql, t));
      const keep = d.columns.map((c, i) => [c, i] as const).filter(([c]) => real.has(c));
      if (keep.length === 0) continue;
      let rows = d.rows;
      if (t === 'categories') {
        const p = d.columns.indexOf('parent_id');
        rows = [...rows].sort((a, b) => (a[p] === null ? 0 : 1) - (b[p] === null ? 0 : 1));
      }
      const cols = keep.map(([c]) => c);
      const stmt = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      for (const r of rows)
        sql.run(
          stmt,
          keep.map(([, i]) => r[i] ?? null),
        );
    }
  }

  /**
   * Replace all data with the backup. If data exists and `confirmReplace` is
   * false, nothing happens ('needs_confirmation'). With confirmation, a safety
   * backup of the current data is written first (same passphrase).
   */
  async function restore(
    opened: OpenedBackup,
    options: { confirmReplace: boolean },
  ): Promise<Result<{ safetyBackupPath: string | null }, RestoreError>> {
    if (hasUserData() && !options.confirmReplace) return err('needs_confirmation');

    const tables =
      opened.payload.schemaVersion === SCHEMA_VERSION
        ? new Map(
            BACKUP_TABLES.flatMap((t) =>
              opened.payload.tables[t] ? [[t, opened.payload.tables[t] as TableDump] as const] : [],
            ),
          )
        : migratedTables(opened.payload);

    let safetyBackupPath: string | null = null;
    if (hasUserData()) {
      const safety = await create(opened.passphrase);
      if (!safety.ok) return err('passphrase_too_short');
      safetyBackupPath = `backups/safety-${deps.now()}.masroof`;
      try {
        await deps.files.write(safetyBackupPath, safety.value);
      } catch {
        return err('restore_failed'); // no safety net → no restore
      }
    }

    // Stage attachments re-encrypted for this device; paths are rebuilt, never taken from the file.
    const staged: { tmp: string; final: string }[] = [];
    const cleanup = () => staged.forEach((s) => safeDelete(s.tmp));
    try {
      for (const [id, bytes] of opened.attachments) {
        const final = `${ATTACHMENT_DIR}/${id}.bin`;
        const tmp = `${final}.restore`;
        await deps.files.write(tmp, seal(deps.attachmentKey, bytes, id, deps.randomBytes));
        staged.push({ tmp, final });
      }
    } catch {
      cleanup();
      return err('restore_failed');
    }

    const oldPaths = [...deps.attachments.referencedPaths()];
    const att = tables.get('attachments');
    if (att) {
      const pathIdx = att.columns.indexOf('file_path');
      const idIdx = att.columns.indexOf('id');
      att.rows = att.rows.map((r) =>
        r.map((v, i) => (i === pathIdx ? `${ATTACHMENT_DIR}/${String(r[idIdx])}.bin` : v)),
      );
    }

    try {
      deps.sql.transaction(() => {
        for (const t of [...BACKUP_TABLES].reverse()) deps.sql.run(`DELETE FROM ${t}`);
        insertAll(deps.sql, tables);
        for (const [t, d] of tables) {
          const n = deps.sql.all<{ n: number }>(`SELECT count(*) AS n FROM ${t}`)[0]?.n ?? -1;
          if (n !== d.rows.length) throw new Error('row count mismatch');
        }
        if (deps.sql.all('PRAGMA foreign_key_check').length > 0)
          throw new Error('foreign key violation');
      });
    } catch {
      cleanup();
      return err('restore_failed'); // transaction rolled back: live data untouched
    }

    const keep = new Set(staged.map((s) => s.final));
    for (const s of staged) deps.files.move(s.tmp, s.final);
    for (const p of oldPaths) if (!keep.has(p)) safeDelete(p);
    return ok({ safetyBackupPath });
  }

  function safeDelete(path: string) {
    try {
      deps.files.delete(path);
    } catch {
      // swept on next launch
    }
  }

  return { create, inspect, open: openBackup, restore, hasUserData };
}

export type BackupService = ReturnType<typeof createBackupService>;
