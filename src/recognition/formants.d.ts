/** Types of ./formants.js (re-exported by src/index.d.ts). */

import type { FrameSet, FrameStage } from './frontend.js';
import type { PitchTrack } from './pitch.js';

/** Options of the formant tracker (issue 60). */
export interface FormantOptions {
  /** Tract length (cm, 10 .. 20); default null: estimated from the tracks
   * (16.5 cm until there is an estimate). */
  vocalTractLength?: number | null;
  /** Pitch track of the same frame set; above 200 Hz its f0 widens the
   * observation variance by (f0 / 4)^2. Default null. */
  pitch?: PitchTrack | null;
  /** Frames between the newest scored frame and the newest committed one,
   * default 10 (50 ms at a 5 ms hop). */
  lag?: number;
  /** Widest candidate bandwidth (Hz), default 700. */
  maxBandwidth?: number;
  /** States (numberings of the candidates) kept per frame, default 12. */
  keep?: number;
  /** Thresholds of the nasal flag, defaults NASAL_BAND_DROP (dB),
   * NASAL_HIGH_DROP (dB) and NASAL_RATIO; not part of FORMANT_DEFAULTS,
   * for calibration. */
  nasalBandDrop?: number;
  nasalHighDrop?: number;
  nasalRatio?: number;
}
export declare const FORMANT_DEFAULTS: Readonly<{
  vocalTractLength: null;
  pitch: null;
  lag: 10;
  maxBandwidth: 700;
  keep: 12;
}>;
/** Drop (dB) from band 0-400 Hz to band 800-1500 Hz below which a frame
 * with a low narrow candidate is a nasal murmur. */
export declare const NASAL_BAND_DROP: number;
/** Drop (dB) from band 800-1500 Hz to band 2000-3500 Hz below which a
 * nasal murmur is told from a close front vowel. */
export declare const NASAL_HIGH_DROP: number;
/** Share of ref[1] (the first resonance of the uniform tube) below which
 * the lowest candidate of a nasal murmur lies. */
export declare const NASAL_RATIO: number;
/**
 * Formant track: one row per frame of the frame set, 4 columns (F1 .. F4)
 * in the matrices; rows before `committed` never change.
 */
export interface FormantTrack {
  /** Hop (s), as in the frame set. */
  hop: number;
  /** Time (s) of row 0. */
  startTime: number;
  /** Scored rows. */
  count: number;
  /** Committed rows. */
  committed: number;
  /** Formants tracked: 4, or 3 at a rate of 8000 Hz (column 4 is NaN). */
  formants: 3 | 4;
  /** Tract length (cm) of the references: the option, the batch estimate
   * or the current stream estimate. */
  vocalTractLength: number;
  /** Smoothed frequency (Hz); NaN where not valid. */
  frequency: Float32Array;
  /** Bandwidth (Hz) of the latest candidate of the formant. */
  bandwidth: Float32Array;
  /** Smoothed variance (Hz^2), times 4 in nasal frames. */
  variance: Float32Array;
  /** Level (dB) of the LPC envelope at the frequency. */
  level: Float32Array;
  /** 1 where the formant has had a candidate within the last 100 ms. */
  valid: Uint8Array;
  /** 1 in frames that look like a nasal murmur; one column. */
  nasal: Uint8Array;
}
/** Streaming tracker: the stage pattern of FrameStage. */
export interface FormantTracker extends FrameStage<FormantTrack> {
  readonly track: FormantTrack;
}
/**
 * Length (cm) of the uniform tube whose resonances (2k - 1) c / (4 L) fit
 * F1 .. F3 best: L = c / (2 dF) with
 * dF = (F1 / 2 + 3 F2 / 2 + 5 F3 / 2) / 8.75 and c = 35000 cm/s.
 */
export declare function tractLengthFromFormants(
  f1: number,
  f2: number,
  f3: number
): number;
/** Streaming formant tracker; the delay is lag * hop (50 ms with the
 * defaults). Throws a RangeError for invalid options. */
export declare function createFormantTracker(
  frames: FrameSet,
  options?: FormantOptions
): FormantTracker;
/** Formant track of a whole frame set. */
export declare function trackFormants(
  frames: FrameSet,
  options?: FormantOptions
): FormantTrack;
/** Raw formant candidates per frame (the roots of the LPC orders p, p - 2
 * and p - 4 that pass the filters), `width` slots per frame; the numbers
 * the Rust core reproduces. Not re-exported by src/index.js. */
export interface FormantCandidates {
  readonly width: number;
  /** Candidates per frame. */
  readonly count: Uint8Array;
  /** Hz, `width` per frame. */
  readonly frequency: Float32Array;
  /** Hz, `width` per frame. */
  readonly bandwidth: Float32Array;
  /** 0 for order p, 1 for p - 2, 2 for p - 4. */
  readonly rank: Uint8Array;
}
export declare function formantCandidates(
  frames: FrameSet,
  options?: FormantOptions
): FormantCandidates;
