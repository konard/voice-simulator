/** Voice configuration fitting (issue 63). */
import type {
  HeadConfig,
  HeadPresetName,
  VoiceFeatures,
  EngineOptions,
} from '../index.js';
export type VoiceFitPart = 'tract' | 'pitch' | 'source' | 'rate';
export interface VoiceFitParameter {
  value: number;
  /** Rough standard deviation indicator, not a confidence interval. */
  sd: number;
  source: 'statistics' | 'refined' | 'default';
  frames: number;
}
export interface VoiceFitState {
  version: 1;
  histograms: Record<string, number[]>;
  duration: number;
  voicedSeconds: number;
  speechSeconds: number;
  /** Committed syllable nuclei (findLandmarks). */
  nuclei: number;
  /** Nuclei near the end that the next stretch confirms, and the last 2 s
   * of sound as 16-bit samples so that they are counted as in one recording. */
  landmarks: { sampleRate: number; pending: number; carry: number[] };
  voicedFrames: number;
  mel: number[];
  tilt: number;
  diagnostics: { hnr: number; h1h2: number; frames: number };
  perturbation: {
    periods: number;
    period: number;
    amplitude: number;
    pairs: number;
    periodDiff: number;
    amplitudeDiff: number;
  };
}
export interface VoiceFitStep {
  step: number;
  renders: number;
  distance: number;
  head: HeadConfig;
}
export interface VoiceFitOptions {
  transcript?: string;
  language?: string;
  /** Legacy alias for language. */
  lang?: string;
  ipa?: boolean;
  refine?: boolean;
  /** Defaults to 8 for 8000 Hz input without a transcript, and 40 otherwise. */
  maxRenders?: number;
  seed?: number | string;
  parts?: VoiceFitPart[];
  state?: VoiceFitState;
  onStep?: (step: VoiceFitStep) => void;
  trace?: (event: Record<string, unknown>) => void;
  maxDuration?: number;
  preset?: HeadPresetName;
  engine?: EngineOptions['engine'];
  source?: 'lf' | 'folds';
}
export interface VoiceFitFeatures extends VoiceFeatures {
  rd: number;
  cpp: number;
  h1h2Source: number;
}
export interface VoiceFitResult {
  head: HeadConfig;
  parameters: Record<string, VoiceFitParameter>;
  preset: Exclude<HeadPresetName, 'any'>;
  features: VoiceFitFeatures;
  /** Null with refine:false or maxRenders:0. */
  rendered: VoiceFitFeatures | null;
  /** Unregularised objective; Infinity before rendering. */
  distance: number;
  renders: number;
  voicedDuration: number;
  state: VoiceFitState;
}
export declare function fitVoice(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: VoiceFitOptions
): VoiceFitResult;
export declare function fitVoiceSteps(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: VoiceFitOptions
): Generator<VoiceFitStep, VoiceFitResult, void>;
export interface VoiceFitter {
  readonly state: VoiceFitState;
  update(samples: ArrayLike<number>, sampleRate: number): VoiceFitter;
  result(
    options?: VoiceFitOptions & {
      samples?: ArrayLike<number>;
      sampleRate?: number;
    }
  ): VoiceFitResult;
}
export declare function createVoiceFitter(
  options?: VoiceFitOptions
): VoiceFitter;
