/**
 * Single-producer, single-consumer ring of mono float samples for the
 * AudioWorklet player (issue 27). One thread writes, one reads; the buffer
 * is a SharedArrayBuffer when the page is cross-origin isolated, so both
 * sides see the same memory, or a plain ArrayBuffer otherwise (tests, and
 * the main-thread copy of the port mode).
 *
 * Layout: an Int32Array header of 8 words at byte 0, then `capacity`
 * float32 samples at byte 32. Every header access goes through `Atomics`.
 * `WRITE` belongs to the writer, `READ` to the reader; one slot stays empty
 * so that `WRITE === READ` means empty. `ringReset` (writer) moves `READ` to
 * `WRITE` and the reader advances `READ` with compareExchange, so a read
 * that races with a reset cannot bring the dropped samples back.
 *
 * No imports and no DOM: the worklet processor repeats `ringRead`.
 */

/** Header word indices. */
export const RING = Object.freeze({
  /** Next sample to write, modulo capacity. */
  WRITE: 0,
  /** Next sample to read, modulo capacity. */
  READ: 1,
  /** Samples played since the last reset (written by the reader). */
  PLAYED: 2,
  /** Underruns since the last reset (written by the reader). */
  UNDERRUNS: 3,
  /** 1 when the writer has no more audio. */
  ENDED: 4,
  /** The writer adds 1 to drop everything. */
  EPOCH: 5,
});

/** Bytes before the samples: 8 Int32 words. */
export const RING_HEADER_BYTES = 32;
const HEADER_WORDS = 8;

/**
 * Views over a ring buffer.
 * @param {ArrayBuffer|SharedArrayBuffer} buffer
 */
export function ringFromBuffer(buffer) {
  const capacity = (buffer.byteLength - RING_HEADER_BYTES) / 4;
  if (!Number.isInteger(capacity) || capacity < 2) {
    throw new Error('Not a ring buffer');
  }
  return {
    buffer,
    header: new Int32Array(buffer, 0, HEADER_WORDS),
    samples: new Float32Array(buffer, RING_HEADER_BYTES, capacity),
    capacity,
  };
}

/**
 * A new, empty ring for `capacity` slots (`capacity - 1` samples fit).
 * @param {number} capacity
 * @param {{shared?: boolean}} [options] `shared: true` for a SharedArrayBuffer
 */
export function createRing(capacity, options = {}) {
  if (!Number.isInteger(capacity) || capacity < 2) {
    throw new Error('Ring capacity must be an integer of at least 2');
  }
  const bytes = RING_HEADER_BYTES + capacity * 4;
  const buffer = options.shared
    ? new SharedArrayBuffer(bytes)
    : new ArrayBuffer(bytes);
  return ringFromBuffer(buffer);
}

/** Samples that can be read now. */
export function ringAvailable(ring) {
  const write = Atomics.load(ring.header, RING.WRITE);
  const read = Atomics.load(ring.header, RING.READ);
  return (write - read + ring.capacity) % ring.capacity;
}

/** Samples that can be written now (one slot always stays empty). */
export function ringFree(ring) {
  return ring.capacity - 1 - ringAvailable(ring);
}

/**
 * Write as much of `chunk` from `offset` on as fits (writer only).
 * @param {{header: Int32Array, samples: Float32Array, capacity: number}} ring
 * @param {ArrayLike<number>} chunk
 * @param {number} [offset]
 * @returns {number} samples written
 */
export function ringWrite(ring, chunk, offset = 0) {
  const { header, samples, capacity } = ring;
  const write = Atomics.load(header, RING.WRITE);
  const read = Atomics.load(header, RING.READ);
  const free = capacity - 1 - ((write - read + capacity) % capacity);
  const count = Math.max(0, Math.min(free, chunk.length - offset));
  for (let index = 0; index < count; index++) {
    samples[(write + index) % capacity] = chunk[offset + index];
  }
  Atomics.store(header, RING.WRITE, (write + count) % capacity);
  return count;
}

/**
 * Read up to `count` samples into the start of `out` (reader only).
 * @param {{header: Int32Array, samples: Float32Array, capacity: number}} ring
 * @param {Float32Array} out
 * @param {number} count
 * @returns {number} samples read
 */
export function ringRead(ring, out, count) {
  const { header, samples, capacity } = ring;
  const read = Atomics.load(header, RING.READ);
  const write = Atomics.load(header, RING.WRITE);
  const available = (write - read + capacity) % capacity;
  const total = Math.max(0, Math.min(available, count, out.length));
  for (let index = 0; index < total; index++) {
    out[index] = samples[(read + index) % capacity];
  }
  // A reset in between moved READ: keep its value, the samples are dropped.
  Atomics.compareExchange(header, RING.READ, read, (read + total) % capacity);
  return total;
}

/** Mark the end of the stream (writer only). */
export function ringEnd(ring) {
  Atomics.store(ring.header, RING.ENDED, 1);
}

/**
 * Drop everything buffered and start a new stream (writer only): the
 * reader sees the new `EPOCH` and waits for its start threshold again.
 */
export function ringReset(ring) {
  const { header } = ring;
  Atomics.store(header, RING.ENDED, 0);
  Atomics.store(header, RING.READ, Atomics.load(header, RING.WRITE));
  Atomics.store(header, RING.PLAYED, 0);
  Atomics.store(header, RING.UNDERRUNS, 0);
  Atomics.add(header, RING.EPOCH, 1);
}
