import { BACKUP_KDF, deriveFromSecret, PIN_KDF } from '@/services/crypto/kdf';
import { createLockService, LOCK_KEY } from '@/services/security/lock-service';

import { FakeVault, MemorySecrets, rnd, TEST_KDF } from '../../helpers/security';

function setup() {
  const secrets = new MemorySecrets();
  const vault = new FakeVault();
  const clock = { now: 1_700_000_000_000 };
  const lock = createLockService({
    secrets,
    vault,
    randomBytes: rnd,
    now: () => clock.now,
    kdf: TEST_KDF,
  });
  return { secrets, vault, clock, lock };
}

describe('J8 app lock: PIN', () => {
  it('no lock by default', async () => {
    const { lock } = setup();
    expect(await lock.status()).toMatchObject({
      pinSet: false,
      biometricsEnabled: false,
      cooldownMs: 0,
    });
    expect(await lock.verifyPin('1234')).toEqual({ status: 'no_pin' });
  });

  it('sets a PIN (hashed, never stored in clear) and verifies it', async () => {
    const { lock, secrets } = setup();
    expect(await lock.setPin('12')).toBe('pin_length');
    expect(await lock.setPin('12ab')).toBe('pin_digits');
    expect(await lock.setPin('2580')).toBeNull();
    expect(secrets.map.get(LOCK_KEY)).not.toContain('2580');
    expect(await lock.verifyPin('2580')).toEqual({ status: 'ok' });
    expect((await lock.verifyPin('0000')).status).toBe('wrong');
  });

  it('5 wrong PINs → escalating cool-down; never wipes; correct PIN works after waiting', async () => {
    const { lock, clock, secrets } = setup();
    await lock.setPin('2580');
    for (let i = 4; i >= 1; i--) {
      expect(await lock.verifyPin('0000')).toEqual({
        status: 'wrong',
        attemptsLeft: i,
        cooldownMs: 0,
      });
    }
    expect(await lock.verifyPin('0000')).toEqual({
      status: 'wrong',
      attemptsLeft: 0,
      cooldownMs: 30_000,
    });
    // Even the right PIN is refused during the cool-down.
    expect(await lock.verifyPin('2580')).toEqual({ status: 'cooldown', cooldownMs: 30_000 });
    clock.now += 30_000;
    expect(await lock.verifyPin('0000')).toEqual({
      status: 'wrong',
      attemptsLeft: 0,
      cooldownMs: 60_000,
    });
    clock.now += 60_000;
    expect(await lock.verifyPin('2580')).toEqual({ status: 'ok' });
    expect(await lock.status()).toMatchObject({ pinSet: true, attemptsLeft: 5, cooldownMs: 0 });
    expect(secrets.map.has(LOCK_KEY)).toBe(true); // nothing wiped
  });

  it('a clock moved backwards does not shorten the cool-down', async () => {
    const { lock, clock } = setup();
    await lock.setPin('2580');
    for (let i = 0; i < 5; i++) await lock.verifyPin('0000');
    clock.now -= 3_600_000;
    expect(await lock.verifyPin('2580')).toEqual({ status: 'cooldown', cooldownMs: 30_000 });
    clock.now += 29_000;
    expect((await lock.verifyPin('2580')).status).toBe('cooldown');
    clock.now += 1_000;
    expect(await lock.verifyPin('2580')).toEqual({ status: 'ok' });
  });

  it('a corrupt lock record keeps the app locked (fails closed)', async () => {
    const { lock, secrets } = setup();
    secrets.map.set(LOCK_KEY, '{not json');
    expect(await lock.status()).toMatchObject({ pinSet: true });
    expect((await lock.verifyPin('1234')).status).toBe('wrong');
  });

  it('rehashes with stronger params after a successful unlock', async () => {
    const secrets = new MemorySecrets();
    const vault = new FakeVault();
    const weak = createLockService({
      secrets,
      vault,
      randomBytes: rnd,
      now: () => 1,
      kdf: { ...TEST_KDF, m: 32 },
    });
    await weak.setPin('2580');
    const strong = createLockService({
      secrets,
      vault,
      randomBytes: rnd,
      now: () => 1,
      kdf: TEST_KDF,
    });
    expect(await strong.verifyPin('2580')).toEqual({ status: 'ok' });
    expect(JSON.parse(secrets.map.get(LOCK_KEY) ?? '{}').pin.kdf).toEqual(TEST_KDF);
    expect(await strong.verifyPin('2580')).toEqual({ status: 'ok' });
  });

  it('disabling the lock removes PIN and biometrics', async () => {
    const { lock, vault } = setup();
    await lock.setPin('2580');
    await lock.enableBiometrics();
    await lock.disableLock();
    expect(await lock.status()).toMatchObject({ pinSet: false, biometricsEnabled: false });
    expect(vault.map.size).toBe(0);
  });
});

describe('J8 app lock: biometrics', () => {
  it('happy path: Face ID unlocks', async () => {
    const { lock } = setup();
    await lock.setPin('2580');
    expect(await lock.enableBiometrics()).toBe('ok');
    expect(await lock.unlockWithBiometrics()).toEqual({ status: 'ok' });
  });

  it('requires a PIN first, and hardware/enrolment', async () => {
    const { lock, vault } = setup();
    expect(await lock.enableBiometrics()).toBe('no_pin');
    await lock.setPin('2580');
    vault.available = false;
    expect(await lock.enableBiometrics()).toBe('unavailable');
    expect(await lock.status()).toMatchObject({ biometricsAvailable: false });
    expect(await lock.unlockWithBiometrics()).toEqual({ status: 'not_enabled' });
  });

  it('biometrics changed at OS level → biometric unlock invalidated, PIN required', async () => {
    const { lock, vault } = setup();
    await lock.setPin('2580');
    await lock.enableBiometrics();
    vault.osInvalidate();
    expect(await lock.unlockWithBiometrics()).toEqual({ status: 'invalidated' });
    expect(await lock.status()).toMatchObject({ biometricsEnabled: false });
    expect(await lock.verifyPin('2580')).toEqual({ status: 'ok' });
  });

  it('a tampered biometric item is treated as invalidated', async () => {
    const { lock, vault } = setup();
    await lock.setPin('2580');
    await lock.enableBiometrics();
    vault.map.set('masroof.lock.bio.v1', 'forged');
    expect(await lock.unlockWithBiometrics()).toEqual({ status: 'invalidated' });
  });

  it('cancelled prompt keeps biometrics enabled', async () => {
    const { lock, vault } = setup();
    await lock.setPin('2580');
    await lock.enableBiometrics();
    vault.cancelNext = true;
    expect(await lock.unlockWithBiometrics()).toEqual({ status: 'cancelled' });
    expect(await lock.status()).toMatchObject({ biometricsEnabled: true });
  });

  it('biometric unlock clears an active PIN cool-down', async () => {
    const { lock } = setup();
    await lock.setPin('2580');
    await lock.enableBiometrics();
    for (let i = 0; i < 5; i++) await lock.verifyPin('0000');
    expect(await lock.unlockWithBiometrics()).toEqual({ status: 'ok' });
    expect(await lock.status()).toMatchObject({ cooldownMs: 0, attemptsLeft: 5 });
  });
});

describe('J8 forgot PIN', () => {
  it('with biometrics: unlock with biometrics, then set a new PIN', async () => {
    const { lock } = setup();
    await lock.setPin('2580');
    await lock.enableBiometrics();
    expect(await lock.resetPinAfterBiometric('1397')).toBe('not_authorized');
    await lock.unlockWithBiometrics();
    expect(await lock.resetPinAfterBiometric('13')).toBe('pin_length');
    expect(await lock.resetPinAfterBiometric('1397')).toBeNull();
    expect(await lock.verifyPin('1397')).toEqual({ status: 'ok' });
    expect(await lock.resetPinAfterBiometric('2222')).toBe('not_authorized'); // one-shot
  });

  it('without biometrics: no way around the PIN (only reset + restore)', async () => {
    const { lock } = setup();
    await lock.setPin('2580');
    expect(await lock.resetPinAfterBiometric('1397')).toBe('not_authorized');
  });

  it('wipe removes every lock secret (J11 reset)', async () => {
    const { lock, secrets, vault } = setup();
    await lock.setPin('2580');
    await lock.enableBiometrics();
    await lock.wipe();
    expect(secrets.map.size).toBe(0);
    expect(vault.map.size).toBe(0);
  });
});

describe('KDF', () => {
  it('production params produce 32 bytes and reject out-of-range params', () => {
    const salt = rnd(16);
    expect(deriveFromSecret('2580', salt, PIN_KDF)).toHaveLength(32);
    expect(deriveFromSecret('pass', salt, BACKUP_KDF)).toHaveLength(32);
    expect(() => deriveFromSecret('x', salt, { ...PIN_KDF, m: 1 << 30 })).toThrow('out of range');
    expect(() => deriveFromSecret('x', salt, { ...PIN_KDF, p: 4 })).toThrow('out of range');
    expect(() => deriveFromSecret('x', salt, { ...PIN_KDF, alg: 'scrypt' as never })).toThrow(
      'unsupported',
    );
  });

  it('normalises Unicode so the same passphrase always derives the same key', () => {
    const salt = rnd(16);
    expect(deriveFromSecret('café', salt, TEST_KDF)).toEqual(
      deriveFromSecret('café', salt, TEST_KDF),
    );
  });
});
