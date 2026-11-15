/** Types of ./resample.js (re-exported by src/index.d.ts). */

/** Band-limited (windowed-sinc) sample-rate conversion. */
export declare function resample(
  samples: ArrayLike<number>,
  fromRate: number,
  toRate: number,
  options?: { zeroCrossings?: number }
): Float32Array;
/** Chunk-by-chunk resampler (issue 27); see createStreamResampler. */
export interface StreamResampler {
  /** Every output sample whose whole filter window has arrived. */
  push(chunk: ArrayLike<number>): Float32Array;
  /** The rest of the output (missing input counts as 0). */
  flush(): Float32Array;
  /** Input samples held for the outputs still to come. */
  held(): number;
}
/**
 * The kernel of `resample` fed one chunk at a time: the joined outputs equal
 * `resample(all, fromRate, toRate, {zeroCrossings})`, which is
 * `Math.round(total * toRate / fromRate)` samples. `zeroCrossings` defaults
 * to 8. Equal rates return copies.
 */
export declare function createStreamResampler(
  fromRate: number,
  toRate: number,
  options?: { zeroCrossings?: number }
): StreamResampler;
