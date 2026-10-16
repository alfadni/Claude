import { invariant } from './result';

/**
 * UUID v7 (RFC 9562): 48-bit Unix-ms timestamp + randomness. Time-ordered, so
 * primary keys insert at the end of the B-tree and sort by creation — useful
 * for the future sync log.
 *
 * Randomness is injected so the domain stays platform-free; the app wires in
 * expo-crypto, tests wire in a deterministic source.
 */
export type Id = string & { readonly __brand: 'Id' };

export type RandomBytes = (length: number) => Uint8Array;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV7(value: string): value is Id {
  return UUID_V7.test(value);
}

export function createIdFactory(randomBytes: RandomBytes, now: () => number = Date.now) {
  let lastMs = -1;
  let counter = 0;

  return function newId(): Id {
    let ms = now();
    // Monotonic within a process even if the clock stalls or steps back
    // (spec J5: device clock moved backwards).
    if (ms <= lastMs) {
      ms = lastMs;
      counter++;
      if (counter > 0xfff) {
        // Sequence exhausted within one ms: borrow the next millisecond.
        ms = lastMs + 1;
        counter = 0;
      }
    } else {
      counter = 0;
    }
    lastMs = ms;

    const bytes = randomBytes(16);
    invariant(bytes.length === 16, 'randomBytes must return 16 bytes');
    const b = Uint8Array.from(bytes);

    let t = ms;
    for (let i = 5; i >= 0; i--) {
      b[i] = t % 256;
      t = Math.floor(t / 256);
    }
    // 12-bit sequence in rand_a (RFC 9562 §6.2 method 1) keeps same-ms ids ordered.
    const seq = counter & 0xfff;
    b[6] = 0x70 | (seq >> 8);
    b[7] = seq & 0xff;
    b[8] = 0x80 | ((b[8] as number) & 0x3f);

    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Id;
  };
}

/** Extract the creation timestamp (ms) from a v7 id. */
export function idTimestamp(id: Id): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
