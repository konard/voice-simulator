import type { FrameSet } from './frontend.js';
import type { PitchTrack } from './pitch.js';

/** Batch glottal inverse filtering of finished speech (issue 61). */
export interface InverseFilterOptions {
  /** Aligned pitch track; otherwise local autocorrelation and median of 5. */
  pitch?: Pick<PitchTrack, 'f0' | 'count' | 'hop' | 'startTime'> | null;
  /** Default 2 * round(rate / 2000) + 4. */
  tractOrder?: number | null;
  /** Default 2 * round(rate / 4000). */
  glottisOrder?: number | null;
  /** Leaky integrator pole, default 0.99. */
  leak?: number;
  /** Analysis block step (s), default 0.01. */
  step?: number;
  /** Local pitch and cepstrum search, Hz; defaults 60 and 400. */
  minF0?: number;
  maxF0?: number;
  /** Optional diagnostic callback; no logging or timing by default. */
  trace?: ((event: { stage: string; [key: string]: unknown }) => void) | null;
}
export declare const INVERSE_FILTER_DEFAULTS: Readonly<{
  pitch: null;
  tractOrder: null;
  glottisOrder: null;
  leak: 0.99;
  step: 0.01;
  minF0: 60;
  maxF0: 400;
  trace: null;
}>;
export type SourceMeasure =
  | 'f0'
  | 'rd'
  | 'fit'
  | 'oq'
  | 'naq'
  | 'h1h2'
  | 'h1h2Source'
  | 'hnr'
  | 'cpp';
export interface SourceSummary {
  /** Percentiles over finite, reliable frames; null when there are none. */
  median: number | null;
  low: number | null;
  high: number | null;
  frames: number;
}
export interface InverseFilterResult {
  hop: number;
  startTime: number;
  count: number;
  rate: number;
  /** One sample per valid working-rate input sample, relative amplitude. */
  flow: Float32Array;
  flowDerivative: Float32Array;
  /** Glottal closure instants (absolute seconds, includes startTime). */
  gci: Float64Array;
  /** Hz; 0 in unvoiced frames. Other measures are NaN when unvoiced. */
  f0: Float32Array;
  rd: Float32Array;
  /** RMS error of the centred LF harmonic levels, dB. */
  fit: Float32Array;
  oq: Float32Array;
  naq: Float32Array;
  /** First minus second harmonic, on speech and on the recovered source. */
  h1h2: Float32Array;
  h1h2Source: Float32Array;
  hnr: Float32Array;
  /** Real cepstral peak above regression line; compare only this definition. */
  cpp: Float32Array;
  reliable: Uint8Array;
  /** False if sub-250 Hz mel energy is over 20 dB below 300-1000 Hz.
   * rd, oq, naq and both H1-H2 are then NaN. */
  lowBand: boolean;
  summary: Record<SourceMeasure, SourceSummary>;
}
export declare function inverseFilter(
  frames: FrameSet,
  options?: InverseFilterOptions
): InverseFilterResult;
/** 1 - rd / 3; effective tenseness at reference breathiness 0.2. */
export declare function rdToTenseness(rd: number): number;
/** Ten unwindowed 256-point LF harmonic levels, dB, harmonics 1..10. */
export declare function lfHarmonics(tenseness: number): Float64Array;
