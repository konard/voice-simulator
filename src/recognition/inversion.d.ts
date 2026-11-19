import type { HeadConfig, Plan } from '../index.js';
import type { FrameSet, FrameStage } from './frontend.js';
import type { Codebook } from './codebook.js';
import type { PitchTrack } from './pitch.js';
import type { FormantTrack } from './formants.js';

export interface InversionOptions {
  voice?: Partial<HeadConfig>;
  /** Defaults to buildCodebook(voice). */
  codebook?: Codebook;
  /** Precomputed on the same frame set; defaults to the pitch tracker. */
  pitch?: PitchTrack;
  /** Precomputed on the same frame set; defaults to the formant tracker. */
  formants?: FormantTrack;
  /** Speech candidates per frame, 1 to 64. Defaults to 16. */
  candidates?: number;
  /** Multiplier on squared, planner-scaled motion. Defaults to 1. */
  smoothness?: number;
  /** Batch-only oral refinement, off by default. */
  refine?: boolean;
  /** Streaming lookahead in scored frames, default 30. */
  lag?: number;
}

export type InversionChannel =
  | 'height'
  | 'backness'
  | 'rounding'
  | 'rhotic'
  | 'palatalization'
  | 'lipAmount'
  | 'lipArea'
  | 'tongueAmount'
  | 'tongueArea'
  | 'tongueLocation'
  | 'tongueWidth'
  | 'velum'
  | 'f0'
  | 'voicing'
  | 'loudness'
  | 'aspiration'
  | 'frication'
  | 'sibilance'
  | 'trill'
  | 'glottalClosure'
  | 'lateral';

export interface InversionCandidates {
  /** Row-major stride, max(32, requested candidates). */
  width: number;
  /** Actual number of candidates at each frame. */
  count: Uint8Array;
  /** Codebook row numbers, -1 for unused cells. */
  index: Int32Array;
  /** Local costs, -1 for unused cells. */
  cost: Float32Array;
}

export interface ArticulationTrack {
  frameRate: number;
  /** Number of scored analysis frames. */
  frameCount: number;
  duration: number;
  startTime: number;
  /** Number of irrevocable rows of the channel, variance and confidence arrays. */
  committed: number;
  head: HeadConfig;
  channels: Record<InversionChannel, Float32Array>;
  variance: Record<InversionChannel, Float32Array>;
  confidence: Float32Array;
  candidates: InversionCandidates;
}

export type InvertedPlan = Pick<
  Plan,
  'head' | 'frameRate' | 'frameCount' | 'duration' | 'channels'
> & {
  tokens: [];
  segments: [];
};
export interface ArticulationInverter extends FrameStage<ArticulationTrack> {
  readonly track: ArticulationTrack;
}
export declare function invertArticulation(
  frames: FrameSet,
  options?: InversionOptions
): ArticulationTrack;
export declare function createArticulationInverter(
  frames: FrameSet,
  options?: Omit<InversionOptions, 'refine'>
): ArticulationInverter;
export declare function articulationPlan(
  track: ArticulationTrack
): InvertedPlan;
