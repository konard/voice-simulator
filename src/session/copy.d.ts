import type {
  HeadConfig,
  LanguageCode,
  Plan,
  RecordingComparison,
  SynthesizeOptions,
  VoiceFile,
} from '../index.js';
import type {
  ModeSpan,
  RecognitionResult,
  RecognizedSegment,
  RecognizedWord,
} from '../recognition/recognizer.js';
import type { VoiceSessionRecognition } from './voice-session.js';

export type ScoreRenderOptions = Pick<
  SynthesizeOptions,
  'tier' | 'sampleRate' | 'seed' | 'engine'
>;
export interface CopyOptions extends ScoreRenderOptions {
  languages?: readonly LanguageCode[];
  voice?: VoiceFile | HeadConfig | string;
  impose?: Partial<
    Record<'durations' | 'pitch' | 'loudness' | 'modes', boolean>
  >;
  refine?: boolean;
  refineBudget?: number;
}
export interface ScoreTrack {
  /** Frames per second. */
  rate: number;
  values: number[];
}
export interface CopyScore {
  format: 'voice-simulator/score';
  version: 1;
  duration: number;
  voice: VoiceFile;
  language?: LanguageCode;
  /** Original phonetic context, including phrase boundaries. */
  ipa?: string;
  words: RecognizedWord[];
  segments: Omit<RecognizedSegment, 'confidence'>[];
  /** Hertz, with zero denoting unvoiced frames. */
  f0: ScoreTrack;
  loudness: ScoreTrack;
  modes: ModeSpan[];
  planDuration?: number;
  render?: Omit<ScoreRenderOptions, 'engine'>;
  articulation?: Partial<
    Record<'height' | 'backness' | 'rounding', ScoreTrack>
  >;
}
export type CopyWarning =
  | { ipa: string; start: number; requested: number; duration: number }
  | { message: string };
export interface CopyMetrics extends RecordingComparison {
  /** Mean absolute start-time difference in milliseconds on paired syllables. */
  timingError: number | null;
  warnings: CopyWarning[];
}
interface RenderedScore {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}
export interface CopyResult extends RenderedScore {
  score: CopyScore;
  voice: VoiceFile;
  recognition: VoiceSessionRecognition & { segments: RecognizedSegment[] };
  metrics: CopyMetrics;
}
export function copyRecording(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: CopyOptions
): CopyResult;
export function renderScore(
  score: CopyScore,
  options?: ScoreRenderOptions
): RenderedScore;
export function toScore(
  plan: Plan,
  recognition: RecognitionResult | VoiceSessionRecognition,
  voice: VoiceFile
): CopyScore;
