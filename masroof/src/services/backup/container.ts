import { DecryptionError, open, seal, sha256Hex, type RandomBytes } from '../crypto/aead';
import type { KdfParams } from '../crypto/kdf';

/**
 * `.masroof` backup container, format 1.
 *
 *   "MSRFBK" 0x00 0x01 | u32 header length | header JSON (UTF-8, plaintext)
 *   then frames:        | u32 frame length | AES-256-GCM sealed frame
 *
 * Every frame's associated data is `sha256(header) + ":" + index`, so the
 * header cannot be edited and frames cannot be dropped, duplicated or
 * reordered without failing authentication. Frame 0 is a fixed "hello", which
 * tells a wrong passphrase apart from a damaged file. The last frame is
 * "end" with the frame count, so truncation is detected.
 */
export const MAGIC = new Uint8Array([0x4d, 0x53, 0x52, 0x46, 0x42, 0x4b, 0x00, 0x01]);
export const FORMAT_VERSION = 1;
const HELLO = 'masroof-backup-hello';

export type BackupHeader = Readonly<{
  format: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: number;
  kdf: KdfParams & { salt: string };
  counts: Readonly<Record<string, number>>;
  attachments: number;
}>;

export const enum FrameType {
  Hello = 0,
  Db = 1,
  Attachment = 2,
  End = 3,
}

export type Frame =
  | { type: FrameType.Db; json: string }
  | { type: FrameType.Attachment; id: string; bytes: Uint8Array };

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function encodeBackup(params: {
  header: BackupHeader;
  key: Uint8Array;
  frames: readonly Frame[];
  randomBytes: RandomBytes;
}): Uint8Array {
  const headerBytes = enc.encode(JSON.stringify(params.header));
  const digest = sha256Hex(headerBytes);
  const parts: Uint8Array[] = [MAGIC, u32(headerBytes.length), headerBytes];
  let index = 0;
  const push = (plain: Uint8Array) => {
    const sealed = seal(params.key, plain, `${digest}:${index++}`, params.randomBytes);
    parts.push(u32(sealed.length), sealed);
  };
  push(concat([new Uint8Array([FrameType.Hello]), enc.encode(HELLO)]));
  for (const f of params.frames) {
    if (f.type === FrameType.Db) push(concat([new Uint8Array([FrameType.Db]), enc.encode(f.json)]));
    else {
      const id = enc.encode(f.id);
      const len = new Uint8Array(2);
      new DataView(len.buffer).setUint16(0, id.length, false);
      push(concat([new Uint8Array([FrameType.Attachment]), len, id, f.bytes]));
    }
  }
  push(
    concat([new Uint8Array([FrameType.End]), enc.encode(JSON.stringify({ frames: index + 1 }))]),
  );
  return concat(parts);
}

export type HeaderError = 'not_a_backup' | 'unsupported_format' | 'corrupt';

/** Read the plaintext header (no passphrase needed): for preview and version checks. */
export function readHeader(
  file: Uint8Array,
):
  | { ok: true; header: BackupHeader; headerBytes: Uint8Array; offset: number }
  | { ok: false; error: HeaderError } {
  if (file.length < MAGIC.length + 4 || !MAGIC.slice(0, 6).every((b, i) => file[i] === b)) {
    return { ok: false, error: 'not_a_backup' };
  }
  if (file[6] !== 0x00 || file[7] !== FORMAT_VERSION)
    return { ok: false, error: 'unsupported_format' };
  const len = new DataView(file.buffer, file.byteOffset).getUint32(8, false);
  if (len > 1_000_000 || 12 + len > file.length) return { ok: false, error: 'corrupt' };
  const headerBytes = file.slice(12, 12 + len);
  try {
    const header = JSON.parse(dec.decode(headerBytes)) as BackupHeader;
    if (
      header.format !== FORMAT_VERSION ||
      !Number.isInteger(header.schemaVersion) ||
      typeof header.kdf?.salt !== 'string'
    ) {
      return { ok: false, error: 'corrupt' };
    }
    return { ok: true, header, headerBytes, offset: 12 + len };
  } catch {
    return { ok: false, error: 'corrupt' };
  }
}

export type DecodeError = HeaderError | 'wrong_passphrase';

/** Decrypt and authenticate every frame. Nothing is returned unless all of it verifies. */
export function decodeBackup(
  file: Uint8Array,
  key: Uint8Array,
): { ok: true; header: BackupHeader; frames: Frame[] } | { ok: false; error: DecodeError } {
  try {
    return decodeUnsafe(file, key);
  } catch {
    // Malformed UTF-8 / JSON inside an authenticated frame: still never trusted.
    return { ok: false, error: 'corrupt' };
  }
}

function decodeUnsafe(
  file: Uint8Array,
  key: Uint8Array,
): { ok: true; header: BackupHeader; frames: Frame[] } | { ok: false; error: DecodeError } {
  const h = readHeader(file);
  if (!h.ok) return h;
  const digest = sha256Hex(h.headerBytes);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let offset = h.offset;
  let index = 0;
  const frames: Frame[] = [];
  let ended = false;
  while (offset < file.length) {
    if (ended) return { ok: false, error: 'corrupt' }; // trailing data after "end"
    if (offset + 4 > file.length) return { ok: false, error: 'corrupt' };
    const len = view.getUint32(offset, false);
    offset += 4;
    if (offset + len > file.length) return { ok: false, error: 'corrupt' }; // truncated
    let plain: Uint8Array;
    try {
      plain = open(key, file.subarray(offset, offset + len), `${digest}:${index}`);
    } catch (e) {
      if (e instanceof DecryptionError && index === 0)
        return { ok: false, error: 'wrong_passphrase' };
      return { ok: false, error: 'corrupt' };
    }
    offset += len;
    const type = plain[0];
    const body = plain.subarray(1);
    if (index === 0) {
      if (type !== FrameType.Hello || dec.decode(body) !== HELLO)
        return { ok: false, error: 'corrupt' };
    } else if (type === FrameType.Db) {
      frames.push({ type: FrameType.Db, json: dec.decode(body) });
    } else if (type === FrameType.Attachment) {
      const idLen = new DataView(body.buffer, body.byteOffset).getUint16(0, false);
      frames.push({
        type: FrameType.Attachment,
        id: dec.decode(body.subarray(2, 2 + idLen)),
        bytes: body.slice(2 + idLen),
      });
    } else if (type === FrameType.End) {
      const end = JSON.parse(dec.decode(body)) as { frames: number };
      if (end.frames !== index + 1) return { ok: false, error: 'corrupt' };
      ended = true;
    } else {
      return { ok: false, error: 'corrupt' };
    }
    index++;
  }
  if (!ended) return { ok: false, error: 'corrupt' }; // truncated before "end"
  return { ok: true, header: h.header, frames };
}
