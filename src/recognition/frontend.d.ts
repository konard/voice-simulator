/** Types of ./frontend.js (re-exported by src/index.d.ts). */

/** Options of the analysis front end (issue 58). */
export interface FrontendOptions {
  /** Working rate (Hz); default the largest of 8000, 11025, 16000 <= input. */
  rate?: number | null;
  /** Window length (s), default 0.025. */
  window?: number;
  /** Hop (s): 0.005 (default) or 0.01. */
  hop?: 0.005 | 0.01;
  /** Pre-emphasis q of the LPC and the mel energies, default 0.97. */
  preEmphasis?: number;
  /** LPC method, default 'burg'. */
  lpc?: 'burg' | 'autocorrelation' | 'covariance';
  /** LPC order; default round(rate / 1000) + 2. */
  order?: number | null;
  /** Mel filters, default 24. */
  melBands?: number;
  /** Cepstral coefficients c0 .. c(n-1), default 13. */
  cepstra?: number;
  /** Longest sound the frame set holds (s), default 30. */
  maxSeconds?: number;
}
export declare const FRONTEND_DEFAULTS: Readonly<{
  rate: null;
  window: 0.025;
  hop: 0.005;
  preEmphasis: 0.97;
  lpc: 'burg';
  order: null;
  melBands: 24;
  cepstra: 13;
  maxSeconds: 30;
}>;
/**
 * Analysis frames: the only data layout later recognition stages read.
 * Arrays have `capacity` rows of which `count` are valid; a matrix is stored
 * row by row (row t starts at t * width). Frame t is centred on working
 * sample round(t hop rate) and its time is startTime + t hop.
 */
export interface FrameSet {
  /** Working rate (Hz). */
  rate: number;
  /** Hop (s). */
  hop: number;
  /** Window (s); N = round(window * rate) samples. */
  window: number;
  /** FFT size: the next power of two not below N. */
  size: number;
  /** LPC order: width of `lpc` and `reflection`. */
  order: number;
  /** Width of `mel`. */
  melBands: number;
  /** Width of `cepstrum`. */
  cepstra: number;
  /** Rows allocated: ceil(maxSeconds / hop). */
  capacity: number;
  /** Valid rows. */
  count: number;
  /** Time (s) of frame 0 and of samples[0]; grows with `trim`. */
  startTime: number;
  /** Working-rate sound from `startTime` on; `sampleCount` are valid. */
  samples: Float32Array;
  sampleCount: number;
  /** 10 log10(mean(x^2) + 1e-10) of the raw frame (dB). */
  energy: Float32Array;
  /** Sign changes over N - 1. */
  zcr: Float32Array;
  /** Power in 50-1000 Hz over power in 1000-3800 Hz (dB). */
  tilt: Float32Array;
  /** Spectral centre of gravity (Hz). */
  gravity: Float32Array;
  /** Normalised autocorrelation peak for 70-400 Hz, 0 .. 1 (Boersma). */
  periodicity: Float32Array;
  /** Noise floor (dB) by minimum statistics. */
  noise: Float32Array;
  /** 10 log10(E + 1e-10) of the LPC residual power E (dB). */
  gain: Float32Array;
  /** 1 for speech, 0 for noise or silence. */
  speech: Uint8Array;
  /** Predictor a_1 .. a_order per frame. */
  lpc: Float32Array;
  /** Reflection coefficients k_1 .. k_order per frame. */
  reflection: Float32Array;
  /** Natural log of the pre-emphasised mel filter energies. */
  mel: Float32Array;
  /** DCT of `mel`: c0 .. c(cepstra - 1). */
  cepstrum: Float32Array;
  /** Power (dB) in 0-400, 800-1500, 1200-2000, 2000-3500, 3500-5000 and
   * 5000-8000 Hz (Liu 1996); -100 above rate / 2. */
  band: Float32Array;
}
/** Streaming analyzer: sound in, frames out. */
export interface FrameAnalyzer {
  readonly frames: FrameSet;
  /** Add input samples; returns the number of frames added. Throws a
   * RangeError when the frame set is full. */
  push(chunk: ArrayLike<number>): number;
  /** End of the stream: adds the frames that need zeros at the end. */
  flush(): number;
  /** Drop the first `count` frames and their samples. */
  trim(count: number): void;
  /** Forget everything. */
  reset(): void;
}
/**
 * Stage pattern of the recognition stages after the front end (issues 59
 * to 66): created with `createX(frames, options)`; `advance(final)`
 * processes the frames added since the last call; output arrays have
 * `frames.capacity` rows and rows before `committed` never change. A stage
 * is invalid after `trim`.
 */
export interface FrameStage<Output extends { committed: number }> {
  readonly frames: FrameSet;
  readonly output: Output;
  advance(final?: boolean): void;
}
/** Working rate for an input rate (Hz); throws a RangeError when invalid. */
export declare function workingRate(
  sampleRate: number,
  rate?: number | null
): number;
export declare function createFrameAnalyzer(
  sampleRate: number,
  options?: FrontendOptions
): FrameAnalyzer;
/** Frames of a whole recording (one push and a flush). */
export declare function analyzeFrames(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: FrontendOptions
): FrameSet;
