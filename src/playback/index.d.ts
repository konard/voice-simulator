/**
 * Type definitions for `voice-simulator/playback` (issue 27): the ring
 * buffer of the AudioWorklet player and the URL of its processor.
 */

/** Header word indices of a ring. */
export declare const RING: Readonly<{
  WRITE: 0;
  READ: 1;
  PLAYED: 2;
  UNDERRUNS: 3;
  ENDED: 4;
  EPOCH: 5;
}>;
/** Bytes before the samples (8 Int32 words). */
export declare const RING_HEADER_BYTES: 32;

export interface Ring {
  buffer: ArrayBuffer | SharedArrayBuffer;
  /** 8 words, accessed with `Atomics` only. */
  header: Int32Array;
  samples: Float32Array;
  /** Slots; `capacity - 1` samples fit. */
  capacity: number;
}

/** A new, empty ring on a SharedArrayBuffer (`shared: true`) or an ArrayBuffer. */
export declare function createRing(
  capacity: number,
  options?: { shared?: boolean }
): Ring;
/** Views over an existing ring buffer. */
export declare function ringFromBuffer(
  buffer: ArrayBuffer | SharedArrayBuffer
): Ring;
/** Samples that can be read now. */
export declare function ringAvailable(ring: Ring): number;
/** Samples that can be written now (one slot always stays empty). */
export declare function ringFree(ring: Ring): number;
/** Write as much of `chunk` from `offset` on as fits; returns the number written. */
export declare function ringWrite(
  ring: Ring,
  chunk: ArrayLike<number>,
  offset?: number
): number;
/** Read up to `count` samples into `out`; returns the number read. */
export declare function ringRead(
  ring: Ring,
  out: Float32Array,
  count: number
): number;
/** Mark the end of the stream (writer). */
export declare function ringEnd(ring: Ring): void;
/** Drop everything and start a new stream (writer). */
export declare function ringReset(ring: Ring): void;

/** Name the processor registers: `'voice-simulator-player'`. */
export declare const PLAYER_PROCESSOR_NAME: 'voice-simulator-player';
/** URL of the processor module for `audioWorklet.addModule`. */
export declare const PLAYER_PROCESSOR_URL: URL;
