import { argon2id } from '@noble/hashes/argon2.js';

/**
 * Argon2id parameters are stored next to every hash / backup, so they can be
 * raised later without breaking old data (rehash on next successful use).
 * See ADR-010 for why the PIN uses lighter settings than backups.
 */
export type KdfParams = Readonly<{ alg: 'argon2id'; m: number; t: number; p: number }>;

/** ≈0.4 s interpreted (Hermes-like); PIN hash lives in Keychain/Keystore. */
export const PIN_KDF: KdfParams = { alg: 'argon2id', m: 1024, t: 2, p: 1 };
/** OWASP minimum (19 MiB, t=2); backups can leave the device, so they get the full cost. */
export const BACKUP_KDF: KdfParams = { alg: 'argon2id', m: 19456, t: 2, p: 1 };

export function deriveFromSecret(secret: string, salt: Uint8Array, params: KdfParams): Uint8Array {
  if (params.alg !== 'argon2id') throw new Error('unsupported kdf');
  // Bounds guard: params come from untrusted backup headers too.
  if (params.m < 8 || params.m > 262_144 || params.t < 1 || params.t > 10 || params.p !== 1) {
    throw new Error('kdf parameters out of range');
  }
  return argon2id(secret.normalize('NFKC'), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: 32,
  });
}
