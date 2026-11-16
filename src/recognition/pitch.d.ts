/** Types of ./pitch.js (re-exported by src/index.d.ts). */

import type { FrameSet, FrameStage } from './frontend.js';

/** Options of the pitch and voicing tracker (issue 59). */
export interface PitchOptions {
  /** Lowest f0 (Hz), default 60; the window is 3 / minF0 seconds. */
  minF0?: number;
  /** Highest f0 (Hz), default 600; below rate / 4. */
  maxF0?: number;
  /** Voiced candidates per frame, default 4. */
  candidates?: number;
  /** Boersma's voicing threshold, default 0.45. */
  voicingThreshold?: number;
  /** Boersma's silence threshold, default 0.03. */
  silenceThreshold?: number;
  /** Preference for high candidates per octave, default 0.01. */
  octaveCost?: number;
  /** Cost of an octave jump per 5 ms step, default 0.7. */
  octaveJumpCost?: number;
  /** Cost of a voiced/unvoiced change per 5 ms step, default 0.28. */
  voicedUnvoicedCost?: number;
  /** Frames between the newest scored frame and the newest committed one,
   * default 20. */
  lag?: number;
}
export declare const PITCH_DEFAULTS: Readonly<{
  minF0: 60;
  maxF0: 600;
  candidates: 4;
  voicingThreshold: 0.45;
  silenceThreshold: 0.03;
  octaveCost: 0.01;
  octaveJumpCost: 0.7;
  voicedUnvoicedCost: 0.28;
  lag: 20;
}>;
/**
 * Pitch track: one row per frame of the frame set; rows before `committed`
 * never change.
 */
export interface PitchTrack {
  /** Hop (s), as in the frame set. */
  hop: number;
  /** Time (s) of row 0. */
  startTime: number;
  /** Scored rows. */
  count: number;
  /** Committed rows. */
  committed: number;
  /** f0 (Hz) of the period that starts at the frame; 0 when unvoiced. */
  f0: Float32Array;
  /** Voicing 0 .. 1; above 0.5 the best voiced candidate beats the
   * unvoiced one. */
  voicing: Float32Array;
  /** Normalised autocorrelation of the chosen candidate (of the best
   * candidate in unvoiced frames). */
  strength: Float32Array;
  /** Times (s) of the glottal period marks of committed voiced runs. */
  marks: Float64Array;
  /** Local jitter (percent): mean |T_i - T_{i+1}| over the mean period;
   * null below 20 periods. */
  jitter: number | null;
  /** Local shimmer (percent) of the peak-to-peak amplitudes; null below 20
   * periods. */
  shimmer: number | null;
  /** 50th, 5th and 95th percentile of the committed voiced f0 (Hz); null
   * without voiced frames. */
  median: number | null;
  low: number | null;
  high: number | null;
}
/** Streaming tracker: the stage pattern of FrameStage. */
export interface PitchTracker extends FrameStage<PitchTrack> {
  readonly track: PitchTrack;
}
/**
 * Head setting (`head.jitter` or `head.shimmer`, standard deviation in
 * percent) that gives a measured jitter or shimmer of `value` percent:
 * value / 1.128 (the exact factor is 2 / sqrt(pi) = 1.12838).
 */
export declare function jitterToHead(value: number): number;
export declare function jitterToHead(value: null | undefined): null;
export declare function jitterToHead(
  value: number | null | undefined
): number | null;
/** Streaming pitch tracker; the delay is lag * hop + half the window
 * (125 ms with the defaults). Throws a RangeError for invalid options. */
export declare function createPitchTracker(
  frames: FrameSet,
  options?: PitchOptions
): PitchTracker;
/** Pitch track of a whole frame set. */
export declare function trackPitch(
  frames: FrameSet,
  options?: PitchOptions
): PitchTrack;
