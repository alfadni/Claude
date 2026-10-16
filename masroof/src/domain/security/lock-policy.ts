/**
 * App-lock rules (spec 7, J8). Pure: the service supplies time and storage.
 *
 * - PIN: 4–6 ASCII digits (Eastern Arabic digits are normalised by the UI).
 * - Five free attempts, then escalating cool-downs: 30 s, 1 min, 5 min,
 *   15 min, and 15 min for every failure after that. Never a data wipe.
 * - A clock moved backwards cannot shorten a cool-down.
 */
export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const FREE_ATTEMPTS = 5;
const COOLDOWNS_MS = [30_000, 60_000, 300_000, 900_000] as const;

export type PinError = 'pin_length' | 'pin_digits';

export function validatePin(pin: string): PinError | null {
  if (!/^\d*$/.test(pin)) return 'pin_digits';
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return 'pin_length';
  return null;
}

/** Trivial PINs are allowed (user's choice) but the UI warns about them. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 1111
  const asc = '0123456789012';
  const desc = '9876543210987';
  return asc.includes(pin) || desc.includes(pin); // 1234, 4321
}

export type AttemptState = Readonly<{
  failures: number;
  /** Epoch ms until which attempts are refused, or null. */
  lockedUntil: number | null;
  /** Epoch ms of the last failure (detects clocks moved backwards). */
  lastFailureAt: number | null;
}>;

export const NO_FAILURES: AttemptState = { failures: 0, lockedUntil: null, lastFailureAt: null };

/** Cool-down applied after the n-th consecutive failure (1-based); 0 = none. */
export function cooldownAfter(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  const i = Math.min(failures - FREE_ATTEMPTS, COOLDOWNS_MS.length - 1);
  return COOLDOWNS_MS[i] as number;
}

/** Remaining cool-down in ms at `now` (0 = may try). */
export function remainingCooldown(state: AttemptState, now: number): number {
  if (state.lockedUntil === null) return 0;
  if (state.lastFailureAt !== null && now < state.lastFailureAt) {
    // Clock moved backwards: restart the full current penalty, never shorten it.
    return cooldownAfter(state.failures);
  }
  return Math.max(0, state.lockedUntil - now);
}

/** State after a wrong PIN. Call only when remainingCooldown() is 0. */
export function recordFailure(state: AttemptState, now: number): AttemptState {
  const failures = state.failures + 1;
  const cooldown = cooldownAfter(failures);
  return { failures, lockedUntil: cooldown > 0 ? now + cooldown : null, lastFailureAt: now };
}

/** If the clock moved back, re-anchor the penalty to the new "now". */
export function normalizeForClock(state: AttemptState, now: number): AttemptState {
  if (state.lastFailureAt !== null && now < state.lastFailureAt && state.lockedUntil !== null) {
    return { ...state, lockedUntil: now + cooldownAfter(state.failures), lastFailureAt: now };
  }
  return state;
}

export function attemptsBeforeCooldown(state: AttemptState): number {
  return Math.max(0, FREE_ATTEMPTS - state.failures);
}

/** Auto-lock (spec 7): lock when the app was in the background at least `timeoutSeconds`. */
export function shouldLockOnResume(
  backgroundedAt: number | null,
  now: number,
  timeoutSeconds: number,
): boolean {
  if (backgroundedAt === null) return false;
  if (now < backgroundedAt) return true; // clock moved back: be safe
  return now - backgroundedAt >= timeoutSeconds * 1000;
}

/** Constant-time comparison of equal-length byte arrays. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export const LOCK_TIMEOUT_CHOICES = [0, 30, 60, 300, 900] as const;
