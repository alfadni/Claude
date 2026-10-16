import {
  attemptsBeforeCooldown,
  constantTimeEqual,
  cooldownAfter,
  isWeakPin,
  NO_FAILURES,
  normalizeForClock,
  recordFailure,
  remainingCooldown,
  shouldLockOnResume,
  validatePin,
  type AttemptState,
} from '@/domain';

describe('PIN rules', () => {
  it.each([
    ['1234', null],
    ['123456', null],
    ['123', 'pin_length'],
    ['1234567', 'pin_length'],
    ['', 'pin_length'],
    ['12a4', 'pin_digits'],
    ['١٢٣٤', 'pin_digits'], // the UI normalises digits before validation
  ])('%p → %p', (pin, error) => {
    expect(validatePin(pin)).toBe(error);
  });

  it('flags weak PINs', () => {
    expect(isWeakPin('1111')).toBe(true);
    expect(isWeakPin('1234')).toBe(true);
    expect(isWeakPin('9876')).toBe(true);
    expect(isWeakPin('8901')).toBe(true); // wraps around 9→0
    expect(isWeakPin('2580')).toBe(false);
    expect(isWeakPin('739104')).toBe(false);
  });
});

describe('J8 escalating cool-down, no wipe', () => {
  const t0 = 1_000_000;
  const fail = (s: AttemptState, n: number, start = t0) => {
    let st = s;
    let now = start;
    for (let i = 0; i < n; i++) {
      now += remainingCooldown(st, now);
      st = recordFailure(st, now);
    }
    return { st, now };
  };

  it('5 free attempts, then 30 s, 1 min, 5 min, 15 min, 15 min…', () => {
    expect([1, 2, 3, 4].map(cooldownAfter)).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9, 50].map(cooldownAfter)).toEqual([
      30_000, 60_000, 300_000, 900_000, 900_000, 900_000,
    ]);
  });

  it('counts attempts left and enforces the cool-down', () => {
    const { st: four } = fail(NO_FAILURES, 4);
    expect(attemptsBeforeCooldown(four)).toBe(1);
    expect(remainingCooldown(four, t0)).toBe(0);
    const { st: five, now } = fail(NO_FAILURES, 5);
    expect(attemptsBeforeCooldown(five)).toBe(0);
    expect(remainingCooldown(five, now)).toBe(30_000);
    expect(remainingCooldown(five, now + 29_999)).toBe(1);
    expect(remainingCooldown(five, now + 30_000)).toBe(0);
    const { st: six, now: n6 } = fail(five, 1, now);
    expect(remainingCooldown(six, n6)).toBe(60_000);
  });

  it('moving the clock backwards never shortens the cool-down', () => {
    const { st, now } = fail(NO_FAILURES, 7);
    expect(remainingCooldown(st, now)).toBe(300_000);
    const earlier = now - 86_400_000; // clock set back a day
    expect(remainingCooldown(st, earlier)).toBe(300_000);
    const anchored = normalizeForClock(st, earlier);
    expect(remainingCooldown(anchored, earlier + 299_999)).toBe(1);
    expect(normalizeForClock(NO_FAILURES, earlier)).toBe(NO_FAILURES);
  });
});

describe('auto-lock', () => {
  it('locks after the configured background time', () => {
    expect(shouldLockOnResume(null, 1000, 60)).toBe(false);
    expect(shouldLockOnResume(0, 59_999, 60)).toBe(false);
    expect(shouldLockOnResume(0, 60_000, 60)).toBe(true);
    expect(shouldLockOnResume(0, 1, 0)).toBe(true); // "immediately"
    expect(shouldLockOnResume(10_000, 5_000, 60)).toBe(true); // clock moved back
  });
});

describe('constantTimeEqual', () => {
  it('compares bytes', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
