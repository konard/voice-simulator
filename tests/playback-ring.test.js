/**
 * Issue 27: the single-producer, single-consumer ring of the AudioWorklet
 * player (src/playback/ring-buffer.js).
 */

import { describe, it, expect } from 'test-anywhere';
import {
  RING,
  RING_HEADER_BYTES,
  createRing,
  ringAvailable,
  ringEnd,
  ringFree,
  ringFromBuffer,
  ringRead,
  ringReset,
  ringWrite,
} from '../src/playback/index.js';

const values = (length, from = 0) =>
  Float32Array.from({ length }, (_, index) => from + index);

describe('playback ring', () => {
  it('has the documented layout', () => {
    const ring = createRing(16);
    expect(ring.buffer.byteLength).toBe(32 + 16 * 4);
    expect(RING_HEADER_BYTES).toBe(32);
    expect([RING.WRITE, RING.READ, RING.PLAYED]).toEqual([0, 1, 2]);
    expect([RING.UNDERRUNS, RING.ENDED, RING.EPOCH]).toEqual([3, 4, 5]);
    expect(ring.header.length).toBe(8);
    expect(ring.samples.byteOffset).toBe(32);
    const shared = createRing(4, { shared: true });
    expect(shared.buffer instanceof SharedArrayBuffer).toBe(true);
    expect(ringFromBuffer(shared.buffer).capacity).toBe(4);
    expect(() => createRing(1)).toThrow();
  });

  it('reads what was written, also across the wrap-around', () => {
    const ring = createRing(8);
    let next = 0;
    let expected = 0;
    for (const [write, read] of [
      [5, 3],
      [4, 6],
      [7, 2],
      [3, 8],
    ]) {
      const written = ringWrite(ring, values(write, next));
      next += written;
      const out = new Float32Array(read);
      const count = ringRead(ring, out, read);
      expect(out.subarray(0, count)).toEqual(values(count, expected));
      expected += count;
      expect(ringAvailable(ring)).toBe(next - expected);
    }
    expect(next > ring.capacity).toBe(true);
  });

  it('writes from an offset', () => {
    const ring = createRing(8);
    expect(ringWrite(ring, values(6), 4)).toBe(2);
    const out = new Float32Array(4);
    expect(ringRead(ring, out, 4)).toBe(2);
    expect(Array.from(out.subarray(0, 2))).toEqual([4, 5]);
  });

  it('refuses more when full (one slot stays empty)', () => {
    const ring = createRing(8);
    expect(ringFree(ring)).toBe(7);
    expect(ringWrite(ring, values(10))).toBe(7);
    expect(ringFree(ring)).toBe(0);
    expect(ringWrite(ring, values(3))).toBe(0);
    expect(ringAvailable(ring)).toBe(7);
  });

  it('empties on a reset and counts the epoch', () => {
    const ring = createRing(8);
    ringWrite(ring, values(5));
    ringEnd(ring);
    Atomics.store(ring.header, RING.PLAYED, 12);
    Atomics.store(ring.header, RING.UNDERRUNS, 2);
    expect(Atomics.load(ring.header, RING.ENDED)).toBe(1);
    ringReset(ring);
    expect(ringAvailable(ring)).toBe(0);
    expect(ringRead(ring, new Float32Array(4), 4)).toBe(0);
    expect(Atomics.load(ring.header, RING.ENDED)).toBe(0);
    expect(Atomics.load(ring.header, RING.PLAYED)).toBe(0);
    expect(Atomics.load(ring.header, RING.UNDERRUNS)).toBe(0);
    expect(Atomics.load(ring.header, RING.EPOCH)).toBe(1);
    expect(ringWrite(ring, values(3, 9))).toBe(3);
    const out = new Float32Array(3);
    ringRead(ring, out, 3);
    expect(Array.from(out)).toEqual([9, 10, 11]);
  });

  it('keeps a reset that happens during a read', () => {
    const ring = createRing(8);
    ringWrite(ring, values(6));
    const proxy = {
      ...ring,
      samples: new Proxy(ring.samples, {
        get(target, key) {
          if (key === '0') {
            // The writer resets while the reader copies.
            ringReset(ring);
          }
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
    };
    expect(ringRead(proxy, new Float32Array(4), 4)).toBe(4);
    expect(ringAvailable(ring)).toBe(0);
  });
});
