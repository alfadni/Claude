import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Small authenticated-encryption toolkit (pure JS, audited @noble libs; no
 * WASM, so it runs on Hermes).
 *
 * Envelope v1: [0x01][12-byte random nonce][AES-256-GCM ciphertext + 16-byte tag]
 * The caller supplies associated data (e.g. the attachment id) so a file
 * cannot be swapped for another one without failing authentication.
 */
const VERSION = 0x01;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const enc = new TextEncoder();

export type RandomBytes = (n: number) => Uint8Array;

export class DecryptionError extends Error {
  constructor(reason: string) {
    super(`Decryption failed: ${reason}`);
    this.name = 'DecryptionError';
  }
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Derive an independent 256-bit sub-key (HKDF-SHA256) for one purpose. */
export function deriveKey(masterKey: Uint8Array, purpose: string): Uint8Array {
  return hkdf(sha256, masterKey, undefined, enc.encode(`masroof/${purpose}`), 32);
}

export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

export function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: string,
  random: RandomBytes,
): Uint8Array {
  if (key.length !== 32) throw new Error('AES-256 needs a 32-byte key');
  const nonce = random(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new Error('bad nonce');
  const ct = gcm(key, nonce, enc.encode(aad)).encrypt(plaintext);
  const out = new Uint8Array(1 + NONCE_BYTES + ct.length);
  out[0] = VERSION;
  out.set(nonce, 1);
  out.set(ct, 1 + NONCE_BYTES);
  return out;
}

export function open(key: Uint8Array, envelope: Uint8Array, aad: string): Uint8Array {
  if (envelope.length < 1 + NONCE_BYTES + TAG_BYTES) throw new DecryptionError('truncated');
  if (envelope[0] !== VERSION) throw new DecryptionError('unknown version');
  const nonce = envelope.subarray(1, 1 + NONCE_BYTES);
  try {
    return gcm(key, nonce, enc.encode(aad)).decrypt(envelope.subarray(1 + NONCE_BYTES));
  } catch {
    throw new DecryptionError('authentication failed');
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 for data: URIs (decrypted images are shown from memory, never written in clear). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out +=
      B64.charAt(n >> 18) +
      B64.charAt((n >> 12) & 63) +
      B64.charAt((n >> 6) & 63) +
      B64.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += `${B64.charAt(n >> 18)}${B64.charAt((n >> 12) & 63)}==`;
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += `${B64.charAt(n >> 18)}${B64.charAt((n >> 12) & 63)}${B64.charAt((n >> 6) & 63)}=`;
  }
  return out;
}
