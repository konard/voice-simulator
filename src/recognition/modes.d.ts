import type {
  Mode,
  PartialMode,
  Voice,
  VoiceFile,
  HeadConfig,
} from '../index.js';

import type { FrameSet } from './frontend.js';

/** Seconds and phonetic spelling from the preceding text recognition step. */
export interface ModeWord {
  start: number;
  end: number;
  ipa: string;
  lang?: string;
  language?: string;
}
export interface RecognizedMode extends Partial<
  Omit<Mode, 'phonation' | 'emotion'>
> {
  start: number;
  end: number;
  from: number;
  to: number;
  phonation?: Partial<Mode['phonation']>;
  emotion?: Partial<Mode['emotion']>;
  notation: string | null;
  confidence: number;
}
export interface RecognizedSound {
  start: number;
  end: number;
  sound: 'inhale' | 'laugh' | 'filler';
  notation: string;
  confidence: number;
}
export type RecognitionModeSpan = RecognizedMode | RecognizedSound;
export interface ModeRecognitionOptions {
  voice?: string | Voice | VoiceFile | { head: HeadConfig };
  modes?: boolean;
  /** Maximum audio length in seconds; default 30. */
  maxSeconds?: number;
  /** Optional front-end frames covering the same recording. */
  frames?: FrameSet;
  /** Optional diagnostics; no audio buffers are retained. */
  trace?: (event: { stage: string; [key: string]: unknown }) => void;
}
export interface ModeRecognitionInput {
  words: ModeWord[];
  ipa?: string;
  lang?: string;
  language?: string;
  modes?: RecognitionModeSpan[];
}
/** Copies result, preserving unrelated fields. Word indexes are end-exclusive. */
export function recognizeModes<T extends ModeRecognitionInput>(
  samples: ArrayLike<number>,
  sampleRate: number,
  result: T,
  options?: ModeRecognitionOptions
): T & { modes: RecognitionModeSpan[]; ipa: string };
/** Includes unlabelled emotion spans; excludes sounds (already in IPA). */
export function toPlanModes(modes: RecognitionModeSpan[]): {
  from: number;
  to: number;
  mode: PartialMode;
}[];
