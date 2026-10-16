import { createIdFactory, idTimestamp, InvariantError, isUuidV7, type Id } from '@/domain';
import { randomBytes } from 'node:crypto';

const rng = (n: number) => new Uint8Array(randomBytes(n));

describe('UUID v7', () => {
  it('produces RFC 9562 v7 ids carrying the timestamp', () => {
    const t = Date.UTC(2026, 9, 15, 12);
    const newId = createIdFactory(rng, () => t);
    const id = newId();
    expect(isUuidV7(id)).toBe(true);
    expect(idTimestamp(id)).toBe(t);
  });

  it('sorts by creation time', () => {
    let t = 1_700_000_000_000;
    const newId = createIdFactory(rng, () => (t += 7));
    const ids = Array.from({ length: 200 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays unique and ordered within one millisecond', () => {
    const newId = createIdFactory(rng, () => 1_700_000_000_000);
    const ids = Array.from({ length: 5000 }, () => newId()); // exceeds the 12-bit sequence
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    ids.forEach((id) => expect(isUuidV7(id)).toBe(true));
  });

  it('stays monotonic when the clock moves backwards', () => {
    const times = [2_000_000, 1_000_000, 1_500_000];
    const newId = createIdFactory(rng, () => times.shift() ?? 0);
    const ids: Id[] = [newId(), newId(), newId()];
    expect([...ids].sort()).toEqual(ids);
  });

  it('rejects a bad random source', () => {
    const newId = createIdFactory(() => new Uint8Array(4));
    expect(() => newId()).toThrow(InvariantError);
  });

  it('recognises non-v7 strings', () => {
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false);
    expect(isUuidV7('not-a-uuid')).toBe(false);
  });
});
