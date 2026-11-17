import type { FrameSet } from './frontend.js';
export type BroadClass =
  | 'silence'
  | 'vowel'
  | 'glide'
  | 'nasal'
  | 'voiced-fricative'
  | 'voiceless-fricative'
  | 'closure'
  | 'burst';
export declare const BROAD_CLASSES: readonly BroadClass[];
export interface LandmarkThresholds {
  silence: number;
  voiced: number;
  fricativeZcr: number;
  fricativeGravity: number;
  nasalDrop: number;
  nasalBelowPeak: number;
  glideBelowPeak: number;
  nucleusAboveNoise: number;
  nucleusDip: number;
  landmarkRise: number;
}
export interface LandmarkOptions {
  thresholds?: Partial<LandmarkThresholds>;
}
export interface Nucleus {
  time: number;
  start: number;
  /** Unknown until a following minimum or nonspeech frame arrives. */
  end: number | null;
  strength: number;
}
export interface Landmark {
  time: number;
  type: 'g+' | 'g-' | 's+' | 's-' | 'b+' | 'b-';
  strength: number;
}
export interface LandmarkResult {
  hop: number;
  startTime: number;
  count: number;
  committed: number;
  classes: Uint8Array;
  sonority: Float32Array;
  landmarks: Landmark[];
  nuclei: Nucleus[];
}
export interface LandmarkDetector {
  readonly frames: FrameSet;
  readonly output: LandmarkResult;
  /** Confirmed nuclei appended by this call; final drains the lookahead. */
  advance(final?: boolean): Nucleus[];
}
export declare function findLandmarks(
  frames: FrameSet,
  options?: LandmarkOptions
): LandmarkResult;
export declare function createLandmarkDetector(
  frames: FrameSet,
  options?: LandmarkOptions
): LandmarkDetector;
