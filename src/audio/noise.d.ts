/** Types of ./noise.js (re-exported by src/index.d.ts). */

/** Noise kinds of createNoise and addNoise (issue 170). */
export type NoiseType =
  | 'white'
  | 'pink'
  | 'brown'
  | 'blue'
  | 'violet'
  | 'speech-shaped'
  | 'babble'
  | 'hum'
  | 'crackle'
  | 'drifting';

export declare const NOISE_TYPES: readonly NoiseType[];

export interface NoiseOptions {
  /** Seed of the generator (default 1); a seed repeats the noise exactly. */
  seed?: string | number;
  /** RMS level in dBFS (default 0: unit RMS). */
  level?: number;
  /** Mains frequency of hum in Hz (default 50). */
  mains?: number;
  /** Speech that babble is made of; without it babble is modulated speech-shaped noise. */
  source?: ArrayLike<number>;
}

/**
 * Seeded noise: white, pink (-3 dB/octave), brown (-6), blue (+3), violet
 * (+6), speech-shaped, babble, mains hum, crackle, or pink noise with a
 * drifting level.
 */
export declare function createNoise(
  type: NoiseType,
  length: number,
  sampleRate: number,
  options?: NoiseOptions
): Float32Array;

/**
 * A noisy copy of speech at a signal-to-noise ratio in dB over the whole
 * input (default white noise at 20 dB). It is not clipped; babble is made
 * of the input itself. An infinite SNR returns a copy.
 */
export declare function addNoise(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: {
    type?: NoiseType;
    snr?: number;
    seed?: string | number;
    mains?: number;
  }
): Float32Array;
