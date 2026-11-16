/** Types of ./tone-model.js (re-exported by src/index.d.ts). */

/** One pitch target of the tone model in semitones. */
export interface ToneInterval {
  /** Seconds. */
  duration: number;
  /** Target line from `from` to `to` over the interval. */
  from: number;
  to: number;
  /** Rate λ of the approach per second. */
  rate: number;
}
/** Value (st), velocity (st/s) and acceleration (st/s²) of the pitch. */
export interface ToneState {
  value: number;
  velocity: number;
  acceleration: number;
}
/** λ per second of the tone model by kind of target. */
export declare const TONE_RATES: Readonly<{
  level: number;
  rise: number;
  fall: number;
  low: number;
  neutral: number;
}>;
/** Chao level of the neutral tone by the kind of tone before it. */
export declare const NEUTRAL_LEVELS: Readonly<{
  high: number;
  rise: number;
  low: number;
  fall: number;
  none: number;
}>;
/**
 * Quantitative target approximation (Prom-on, Xu and Thipakorn 2009):
 * approach the targets one after the other from `state` (null: the first
 * `from` at rest). One value per frame and the end state.
 */
export declare function approachTargets(
  intervals: ToneInterval[],
  state: ToneState | null,
  frameRate: number
): { values: Float64Array; state: ToneState };
/** Pitch targets of one Chao tone in level units over `duration` seconds. */
export declare function toneIntervals(
  tone: number[],
  duration: number
): ToneInterval[];
/** Chao level of a neutral syllable after `previousTone` (none: 2). */
export declare function neutralLevel(previousTone?: number[] | null): number;
/**
 * Pitch curve of one syllable in semitones around level 3 (`count` values
 * from start to end); an empty or missing tone is neutral.
 */
export declare function toneCurve(
  tone: number[] | null | undefined,
  options?: {
    start?: number;
    scale?: number;
    duration?: number;
    count?: number;
    previous?: number[] | null;
  }
): number[];
