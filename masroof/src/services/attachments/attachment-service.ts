import type { AttachmentsRepository } from '@/data/repositories/attachments-repository';
import { MAX_ATTACHMENTS, type Id } from '@/domain';

import { open, seal, sha256Hex, toBase64, type RandomBytes } from '../crypto/aead';

/** Port over the app-sandbox file system (expo-file-system on device). */
export interface FileStore {
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  move(from: string, to: string): void;
  delete(path: string): void;
  list(dir: string): string[];
  availableBytes(): number;
}

/** Compresses a picked image to ≤1600px JPEG q0.7 (spec 2) and returns its bytes. */
export type ImageCompressor = (sourceUri: string) => Promise<Uint8Array>;

export type AddResult =
  | { status: 'ok'; id: string }
  | { status: 'limit_reached' }
  | { status: 'not_found' }
  | { status: 'processing_failed' }
  /** Device storage full: the transaction is unaffected; offer retry (J2). */
  | { status: 'storage_full' }
  | { status: 'write_failed' };

export const ATTACHMENT_DIR = 'attachments';
const HEADROOM_BYTES = 2 * 1024 * 1024;

/**
 * Encrypted receipt photos. Files are written as `<id>.bin.tmp`, then renamed,
 * then recorded in the DB; any failure removes what was written, so neither
 * orphan files nor dangling rows survive (J2 "no orphan files").
 */
export function createAttachmentService(deps: {
  repo: AttachmentsRepository;
  files: FileStore;
  compress: ImageCompressor;
  key: Uint8Array;
  randomBytes: RandomBytes;
  newId: () => Id;
}) {
  const safeDelete = (path: string) => {
    try {
      deps.files.delete(path);
    } catch {
      // best effort; the orphan sweep retries on next launch
    }
  };

  return {
    async add(transactionId: string, sourceUri: string): Promise<AddResult> {
      if (deps.repo.liveCount(transactionId) >= MAX_ATTACHMENTS) return { status: 'limit_reached' };

      let plain: Uint8Array;
      try {
        plain = await deps.compress(sourceUri);
      } catch {
        return { status: 'processing_failed' };
      }
      if (deps.files.availableBytes() < plain.length * 2 + HEADROOM_BYTES) {
        return { status: 'storage_full' };
      }

      const id = deps.newId();
      const path = `${ATTACHMENT_DIR}/${id}.bin`;
      const tmp = `${path}.tmp`;
      const envelope = seal(deps.key, plain, id, deps.randomBytes);
      try {
        await deps.files.write(tmp, envelope);
        deps.files.move(tmp, path);
      } catch (e) {
        safeDelete(tmp);
        safeDelete(path);
        return {
          status: /ENOSPC|no space|full/i.test(String(e)) ? 'storage_full' : 'write_failed',
        };
      }

      const inserted = deps.repo.insert({
        id,
        transactionId,
        filePath: path,
        mime: 'image/jpeg',
        sizeBytes: envelope.length,
        sha256: sha256Hex(plain),
      });
      if (inserted !== 'ok') {
        safeDelete(path);
        return { status: inserted };
      }
      return { status: 'ok', id };
    },

    /** Decrypt and verify; returns a data: URI for <Image>. Throws on tamper/corruption. */
    async readAsDataUri(row: {
      id: string;
      filePath: string;
      mime: string;
      sha256: string;
    }): Promise<string> {
      const plain = open(deps.key, await deps.files.read(row.filePath), row.id);
      if (sha256Hex(plain) !== row.sha256) throw new Error('attachment checksum mismatch');
      return `data:${row.mime};base64,${toBase64(plain)}`;
    },

    /** Delete files left behind by crashes (tmp files, files with no DB row). */
    sweepOrphans(): number {
      const referenced = deps.repo.referencedPaths();
      let removed = 0;
      for (const name of deps.files.list(ATTACHMENT_DIR)) {
        const path = `${ATTACHMENT_DIR}/${name}`;
        if (name.endsWith('.tmp') || !referenced.has(path)) {
          safeDelete(path);
          removed++;
        }
      }
      return removed;
    },

    deleteFiles(paths: readonly string[]): void {
      paths.forEach(safeDelete);
    },
  };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
