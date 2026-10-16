import { randomBytes as nodeRandom } from 'node:crypto';

import { createAttachmentService, type FileStore } from '@/services/attachments/attachment-service';
import {
  deriveKey,
  DecryptionError,
  open,
  seal,
  sha256Hex,
  toBase64,
} from '@/services/crypto/aead';

import { createLedger, must } from '../../helpers/ledger';

const rnd = (n: number) => new Uint8Array(nodeRandom(n));

class MemoryFiles implements FileStore {
  files = new Map<string, Uint8Array>();
  free = 1e9;
  failWrite: Error | null = null;
  async write(path: string, bytes: Uint8Array) {
    if (this.failWrite) {
      this.files.set(path, bytes.slice(0, 3)); // partial write before failing
      throw this.failWrite;
    }
    this.files.set(path, bytes);
  }
  async read(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error('ENOENT');
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
    return this.free;
  }
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

function setup() {
  const l = createLedger();
  const files = new MemoryFiles();
  const key = deriveKey(rnd(32), 'attachments/v1');
  const service = createAttachmentService({
    repo: l.repos.attachments,
    files,
    compress: async (uri) => {
      if (uri === 'broken') throw new Error('decode failed');
      return JPEG;
    },
    key,
    randomBytes: rnd,
    newId: l.newId,
  });
  const { id: txId } = must(l.repos.transactions.create(l.expense()));
  return { l, files, key, service, txId };
}

describe('aead', () => {
  const key = rnd(32);
  it('round-trips and binds associated data', () => {
    const env = seal(key, JPEG, 'att-1', rnd);
    expect(env[0]).toBe(1);
    expect(env.length).toBe(1 + 12 + JPEG.length + 16);
    expect(open(key, env, 'att-1')).toEqual(JPEG);
    expect(() => open(key, env, 'att-2')).toThrow(DecryptionError); // swapped file
  });

  it('detects tampering, truncation, wrong key and unknown versions', () => {
    const env = seal(key, JPEG, 'a', rnd);
    const flipped = env.slice();
    flipped[20] = (flipped[20] as number) ^ 1;
    expect(() => open(key, flipped, 'a')).toThrow(DecryptionError);
    expect(() => open(key, env.slice(0, 10), 'a')).toThrow(DecryptionError);
    expect(() => open(rnd(32), env, 'a')).toThrow(DecryptionError);
    const v2 = env.slice();
    v2[0] = 2;
    expect(() => open(key, v2, 'a')).toThrow(/unknown version/);
  });

  it('never reuses a nonce', () => {
    const a = seal(key, JPEG, 'a', rnd);
    const b = seal(key, JPEG, 'a', rnd);
    expect(Buffer.from(a.subarray(1, 13)).equals(Buffer.from(b.subarray(1, 13)))).toBe(false);
  });

  it('derives independent sub-keys per purpose', () => {
    const master = rnd(32);
    expect(deriveKey(master, 'a')).not.toEqual(deriveKey(master, 'b'));
    expect(deriveKey(master, 'a')).toEqual(deriveKey(master, 'a'));
  });

  it('encodes base64 like Node', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100]) {
      const b = rnd(n);
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });
});

describe('attachment service (J2 photos)', () => {
  it('stores an encrypted file, records it, and reads it back', async () => {
    const { l, files, service, txId } = setup();
    const r = await service.add(txId, 'file:///photo.jpg');
    expect(r.status).toBe('ok');
    const [row] = l.repos.attachments.listFor(txId);
    expect(row).toMatchObject({ mime: 'image/jpeg', sha256: sha256Hex(JPEG) });
    const stored = files.files.get(row?.filePath ?? '');
    expect(stored).toBeDefined();
    expect(Buffer.from(stored ?? []).includes(Buffer.from(JPEG))).toBe(false); // not plaintext on disk
    const uri = await service.readAsDataUri(row as never);
    expect(uri).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`);
    expect([...files.files.keys()].some((k) => k.endsWith('.tmp'))).toBe(false);
  });

  it('storage full: transaction unaffected, no orphan files, retry works', async () => {
    const { l, files, service, txId } = setup();
    files.free = 100;
    expect(await service.add(txId, 'x')).toEqual({ status: 'storage_full' });
    files.free = 1e9;
    files.failWrite = new Error('ENOSPC: no space left on device');
    expect(await service.add(txId, 'x')).toEqual({ status: 'storage_full' });
    expect(files.files.size).toBe(0);
    expect(l.repos.attachments.listFor(txId)).toEqual([]);
    expect(l.repos.transactions.get(txId)?.deletedAt).toBeNull();
    files.failWrite = null;
    expect((await service.add(txId, 'x')).status).toBe('ok'); // retry
  });

  it('other write errors are reported distinctly', async () => {
    const { files, service, txId } = setup();
    files.failWrite = new Error('EIO');
    expect(await service.add(txId, 'x')).toEqual({ status: 'write_failed' });
    expect(files.files.size).toBe(0);
  });

  it('unreadable images are reported', async () => {
    const { service, txId } = setup();
    expect(await service.add(txId, 'broken')).toEqual({ status: 'processing_failed' });
  });

  it('enforces 5 per transaction and removes the file when the DB rejects it', async () => {
    const { files, service, txId } = setup();
    for (let i = 0; i < 5; i++) expect((await service.add(txId, 'x')).status).toBe('ok');
    expect(await service.add(txId, 'x')).toEqual({ status: 'limit_reached' });
    expect(files.files.size).toBe(5);
    expect(await service.add('missing-tx', 'x')).toEqual({ status: 'not_found' });
    expect(files.files.size).toBe(5);
  });

  it('detects a tampered file on read', async () => {
    const { l, files, service, txId } = setup();
    await service.add(txId, 'x');
    const [row] = l.repos.attachments.listFor(txId);
    const f = files.files.get(row?.filePath ?? '') as Uint8Array;
    f[f.length - 1] = (f[f.length - 1] as number) ^ 0xff;
    await expect(service.readAsDataUri(row as never)).rejects.toThrow(DecryptionError);
  });

  it('sweeps orphans but keeps files referenced by live or trashed rows', async () => {
    const { l, files, service, txId } = setup();
    await service.add(txId, 'x');
    must(l.repos.transactions.delete(txId)); // in Trash: file must survive
    files.files.set('attachments/stray.bin', new Uint8Array(1));
    files.files.set('attachments/crash.bin.tmp', new Uint8Array(1));
    expect(service.sweepOrphans()).toBe(2);
    expect(files.files.size).toBe(1);
    const purged = l.repos.transactions.purgeExpired(); // not expired yet
    expect(purged.purged).toBe(0);
  });
});
