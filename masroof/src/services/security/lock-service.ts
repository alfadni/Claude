import {
  attemptsBeforeCooldown,
  constantTimeEqual,
  NO_FAILURES,
  normalizeForClock,
  recordFailure,
  remainingCooldown,
  validatePin,
  type AttemptState,
  type PinError,
} from '@/domain';

import { bytesToHex, hexToBytes, sha256Hex } from '../crypto/aead';
import { deriveFromSecret, PIN_KDF, type KdfParams } from '../crypto/kdf';

/** Plain Keychain/Keystore (WHEN_UNLOCKED_THIS_DEVICE_ONLY). */
export interface Secrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Keychain/Keystore items gated by biometrics. The OS invalidates them when
 * biometrics change (new fingerprint/face): `get` then resolves null (J8).
 */
export interface BiometricVault {
  isAvailable(): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  /** Prompts for biometrics. null = invalidated or missing; throws on cancel/failure. */
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export type LockPorts = Readonly<{
  secrets: Secrets;
  vault: BiometricVault;
  randomBytes: (n: number) => Uint8Array;
  now: () => number;
  kdf?: KdfParams;
}>;

type StoredPin = { hash: string; salt: string; kdf: KdfParams };
type LockRecord = {
  v: 1;
  pin: StoredPin | null;
  biometrics: { tokenSha256: string } | null;
  attempts: AttemptState;
};

export const LOCK_KEY = 'masroof.lock.v1';
export const BIO_KEY = 'masroof.lock.bio.v1';

export type LockStatus = Readonly<{
  pinSet: boolean;
  biometricsEnabled: boolean;
  biometricsAvailable: boolean;
  cooldownMs: number;
  attemptsLeft: number;
}>;

export type VerifyResult =
  | { status: 'ok' }
  | { status: 'wrong'; attemptsLeft: number; cooldownMs: number }
  | { status: 'cooldown'; cooldownMs: number }
  | { status: 'no_pin' };

export type BiometricResult =
  | { status: 'ok' }
  /** Biometrics changed at OS level: biometric unlock disabled, PIN required (J8). */
  | { status: 'invalidated' }
  | { status: 'cancelled' }
  | { status: 'not_enabled' };

const EMPTY: LockRecord = { v: 1, pin: null, biometrics: null, attempts: NO_FAILURES };

export function createLockService(ports: LockPorts) {
  const kdf = ports.kdf ?? PIN_KDF;
  /** Set only after a successful biometric unlock; permits "forgot PIN → reset". */
  let biometricSessionOk = false;

  async function load(): Promise<LockRecord> {
    const raw = await ports.secrets.get(LOCK_KEY);
    if (!raw) return EMPTY;
    try {
      const r = JSON.parse(raw) as LockRecord;
      return r.v === 1 ? r : EMPTY;
    } catch {
      // A corrupt lock record must not open the app: keep a PIN requirement
      // impossible to satisfy rather than silently disabling the lock.
      return { ...EMPTY, pin: { hash: 'corrupt', salt: '', kdf } };
    }
  }

  const save = (r: LockRecord) => ports.secrets.set(LOCK_KEY, JSON.stringify(r));

  function hashPin(pin: string, salt: Uint8Array, params: KdfParams): string {
    return bytesToHex(deriveFromSecret(pin, salt, params));
  }

  async function writePin(r: LockRecord, pin: string): Promise<void> {
    const salt = ports.randomBytes(16);
    await save({
      ...r,
      pin: { hash: hashPin(pin, salt, kdf), salt: bytesToHex(salt), kdf },
      attempts: NO_FAILURES,
    });
  }

  return {
    async status(): Promise<LockStatus> {
      const r = await load();
      const now = ports.now();
      return {
        pinSet: r.pin !== null,
        biometricsEnabled: r.biometrics !== null,
        biometricsAvailable: await ports.vault.isAvailable().catch(() => false),
        cooldownMs: remainingCooldown(r.attempts, now),
        attemptsLeft: attemptsBeforeCooldown(r.attempts),
      };
    },

    async setPin(pin: string): Promise<PinError | null> {
      const e = validatePin(pin);
      if (e) return e;
      await writePin(await load(), pin);
      return null;
    },

    async verifyPin(pin: string): Promise<VerifyResult> {
      const now = ports.now();
      const loaded = await load();
      const pinRecord = loaded.pin;
      if (!pinRecord) return { status: 'no_pin' };
      const r: LockRecord = { ...loaded, attempts: normalizeForClock(loaded.attempts, now) };
      const wait = remainingCooldown(r.attempts, now);
      if (wait > 0) {
        await save(r);
        return { status: 'cooldown', cooldownMs: wait };
      }
      let ok = false;
      try {
        const expected = hexToBytes(pinRecord.hash);
        const actual = hexToBytes(hashPin(pin, hexToBytes(pinRecord.salt), pinRecord.kdf));
        ok = constantTimeEqual(expected, actual);
      } catch {
        ok = false;
      }
      if (ok) {
        // Rehash with current params if they were raised since this PIN was set.
        if (JSON.stringify(pinRecord.kdf) !== JSON.stringify(kdf)) await writePin(r, pin);
        else await save({ ...r, attempts: NO_FAILURES });
        return { status: 'ok' };
      }
      const attempts = recordFailure(r.attempts, now);
      await save({ ...r, attempts });
      return {
        status: 'wrong',
        attemptsLeft: attemptsBeforeCooldown(attempts),
        cooldownMs: remainingCooldown(attempts, now),
      };
    },

    /** Turning the lock off requires the current PIN (checked by the caller via verifyPin). */
    async disableLock(): Promise<void> {
      await ports.vault.delete(BIO_KEY).catch(() => undefined);
      await save(EMPTY);
    },

    async enableBiometrics(): Promise<'ok' | 'no_pin' | 'unavailable'> {
      const r = await load();
      if (!r.pin) return 'no_pin';
      if (!(await ports.vault.isAvailable().catch(() => false))) return 'unavailable';
      const token = bytesToHex(ports.randomBytes(32));
      await ports.vault.set(BIO_KEY, token);
      await save({ ...r, biometrics: { tokenSha256: sha256Hex(new TextEncoder().encode(token)) } });
      return 'ok';
    },

    async disableBiometrics(): Promise<void> {
      await ports.vault.delete(BIO_KEY).catch(() => undefined);
      await save({ ...(await load()), biometrics: null });
    },

    async unlockWithBiometrics(): Promise<BiometricResult> {
      const r = await load();
      if (!r.biometrics) return { status: 'not_enabled' };
      let token: string | null;
      try {
        token = await ports.vault.get(BIO_KEY);
      } catch {
        return { status: 'cancelled' };
      }
      const valid =
        token !== null &&
        constantTimeEqual(
          hexToBytes(sha256Hex(new TextEncoder().encode(token))),
          hexToBytes(r.biometrics.tokenSha256),
        );
      if (!valid) {
        // OS invalidated the item (biometrics changed): fall back to PIN for good.
        await ports.vault.delete(BIO_KEY).catch(() => undefined);
        await save({ ...r, biometrics: null });
        return { status: 'invalidated' };
      }
      biometricSessionOk = true;
      await save({ ...r, attempts: NO_FAILURES });
      return { status: 'ok' };
    },

    /** Forgot PIN (J8): only possible right after a successful biometric unlock. */
    async resetPinAfterBiometric(newPin: string): Promise<PinError | 'not_authorized' | null> {
      if (!biometricSessionOk) return 'not_authorized';
      const e = validatePin(newPin);
      if (e) return e;
      await writePin(await load(), newPin);
      biometricSessionOk = false;
      return null;
    },

    /** Used by reset (J11): remove every lock secret. */
    async wipe(): Promise<void> {
      await ports.vault.delete(BIO_KEY).catch(() => undefined);
      await ports.secrets.delete(LOCK_KEY);
    },
  };
}

export type LockService = ReturnType<typeof createLockService>;
