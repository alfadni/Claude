import { randomBytes } from 'node:crypto';

import type { BiometricVault, Secrets } from '@/services/security/lock-service';

export const rnd = (n: number) => new Uint8Array(randomBytes(n));

/** Light params so tests stay fast; production params are exercised separately. */
export const TEST_KDF = { alg: 'argon2id', m: 64, t: 1, p: 1 } as const;

export class MemorySecrets implements Secrets {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
  }
  async delete(k: string) {
    this.map.delete(k);
  }
}

/** Simulates a biometric Keychain item: OS invalidation, cancel, unavailable. */
export class FakeVault implements BiometricVault {
  map = new Map<string, string>();
  available = true;
  cancelNext = false;
  async isAvailable() {
    return this.available;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
  }
  async get(k: string) {
    if (this.cancelNext) {
      this.cancelNext = false;
      throw new Error('user cancel');
    }
    return this.map.get(k) ?? null;
  }
  async delete(k: string) {
    this.map.delete(k);
  }
  /** What iOS/Android do when a fingerprint/face is added. */
  osInvalidate() {
    this.map.clear();
  }
}
