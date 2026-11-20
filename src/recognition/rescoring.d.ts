import type { Plan } from '../index.js';
import type { IpaDecodeResult, IpaSegment, IpaStreamResult } from './decode.js';
import type { WhisperSpan } from './whisper.js';

export interface RescoringOptions {
  /** Keep at most this many alternatives per region. Defaults to 5. */
  maxAlternatives?: number;
  /** Maximum decoder cost gap between the two cheapest pieces. Defaults to 3. */
  margin?: number;
  /** Seconds of audio allowed for alternative renders, plus one region. */
  maxRenderSeconds?: number;
  /** Multiplier for mel-cepstral distance. Defaults to the tuned weight. */
  weight?: number;
  /** Preserve the timing of the published phones and syllables of this phrase. */
  preserveTiming?: boolean;
}

export interface RescoringStatistics {
  regions: number;
  scored: number;
  renders: number;
  changed: number;
  renderSeconds: number;
  /** Elapsed wall time in seconds. */
  seconds: number;
}

export type WarpedPlan = Plan & {
  /** Recording time at sample zero. Segment and control times are plan-local. */
  offset: number;
};

interface TimeGrid {
  start: number;
  step: number;
}

interface ScoringWindow {
  rows: Float64Array[];
  first: number;
  last: number;
}

interface JobInput {
  start: number;
  end: number;
  from: number;
  to: number;
  grid: TimeGrid;
  recording: ScoringWindow;
  bias: Float64Array;
  rate: number;
  whisperSpans?: readonly WhisperSpan[];
}

/** A cloneable job reuses reference cepstra or renders its own reading. */
export type RescoringJob = JobInput &
  (
    | { reference: Float64Array[]; plan?: never }
    | { plan: WarpedPlan; reference?: never }
  );

interface RegionAlternative {
  key: string;
  cost: number;
  segments: IpaSegment[];
}

export interface RescoringPreparation {
  preserveTiming: boolean;
  regions: number;
  scheduled: {
    start: number;
    end: number;
    phones: number;
    keys: string[];
    alternatives: RegionAlternative[];
  }[];
  jobs: RescoringJob[];
  renders: number;
  renderSeconds: number;
}

export type RescoredIpa<T = IpaDecodeResult> = T & {
  rescoring: RescoringStatistics;
};

type Decoded = IpaDecodeResult | IpaStreamResult;

/** Both columns contain strictly increasing times in seconds. */
export function warpPlan(
  plan: Plan,
  anchors: readonly (readonly [from: number, to: number])[]
): WarpedPlan;
export function planReading(
  decoded: Decoded,
  segments: readonly IpaSegment[]
): WarpedPlan;
export function planRescoring(
  decoded: Decoded,
  options?: RescoringOptions
): RescoringPreparation;
export function scoreJob(job: RescoringJob): number;
export function rescoreHypotheses<T extends Decoded>(
  decoded: T,
  options?: RescoringOptions
): RescoredIpa<T>;
