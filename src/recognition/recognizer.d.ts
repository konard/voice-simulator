import type { EngineName, HeadConfig, LanguageCode } from '../index.js';
import type { audioToIpa, IpaDecodeOptions } from './decode.js';
import type { ipaToText } from './ipa-to-text.js';
import type { identifyLanguage, LanguageShare } from './language-id.js';
import type { RecognitionModeSpan } from './modes.js';
import type { ProsodyModeSpan } from './prosody.js';

export type { LanguageShare } from './language-id.js';
export type ModeSpan = RecognitionModeSpan | ProsodyModeSpan;
export type RecognitionLevel = 'low' | 'medium' | 'high';

export interface RecognitionEngineOptions {
  /** Auto selects the scalar Rust engine when available. */
  engine?: EngineName;
  /** Auto uses up to eight logical cores for batch recognition. */
  threads?: number | 'auto';
}

export interface RecognitionEngine {
  readonly name: 'js' | 'rust';
  readonly threads: number | 'auto';
}

export interface RecognitionOptions extends RecognitionEngineOptions {
  languages?: readonly LanguageCode[];
  voice?: HeadConfig | null;
  /** Maximum number of results including the primary result, from 1 to 10. */
  nbest?: number;
  rescoring?: boolean;
  modes?: boolean;
  /** Detect whisper, disable it, or supply spans in seconds from input start. */
  whisper?: IpaDecodeOptions['whisper'];
  level?: RecognitionLevel | 'auto';
  /** Test substitutions. Stream IPA substitutions run on partial and final snapshots. */
  stages?: {
    audioToIpa?: typeof audioToIpa;
    identifyLanguage?: typeof identifyLanguage;
    ipaToText?: typeof ipaToText;
  };
}

export interface RecognizedSyllable {
  text: string;
  ipa: string;
  start: number;
  end: number;
  stress: number;
}

export interface RecognizedWord {
  text: string;
  ipa: string;
  language: LanguageCode;
  start: number;
  end: number;
  confidence: number;
  syllables: RecognizedSyllable[];
}

export interface RecognitionResult {
  ipa: string;
  text: string;
  languages: LanguageShare[];
  words: RecognizedWord[];
  modes: ModeSpan[];
  voice: null;
  alternatives?: { text: string; ipa: string; confidence: number }[];
}

export interface RecognitionEvents {
  syllable: { index: number; start: number; end: number; ipa: string };
  partial: Pick<RecognitionResult, 'words' | 'ipa' | 'text'>;
  final: Pick<
    RecognitionResult,
    'words' | 'ipa' | 'text' | 'languages' | 'modes'
  >;
  error: Error;
}

export interface Recognizer {
  push(chunk: Float32Array): void;
  flush(): RecognitionResult;
  reset(): void;
  on<K extends keyof RecognitionEvents>(
    event: K,
    listener: (value: RecognitionEvents[K]) => void
  ): void;
  off<K extends keyof RecognitionEvents>(
    event: K,
    listener: (value: RecognitionEvents[K]) => void
  ): void;
}

export class RecognitionError extends Error {
  readonly code: string;
  constructor(code: string, message?: string);
}

export const RECOGNITION_LEVELS: Readonly<{
  low: Readonly<{ rate: 8000; hop: 0.01; beam: 8 }>;
  medium: Readonly<{ rate: 16000; hop: 0.005; beam: 32 }>;
  high: Readonly<{ rate: 16000; hop: 0.005; beam: 128 }>;
}>;

export function levelForTier(name: string): RecognitionLevel;
export function recognize(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: RecognitionOptions & { threads?: 1 }
): RecognitionResult;
export function recognize(
  samples: ArrayLike<number>,
  sampleRate: number,
  options: RecognitionOptions & { threads: 'auto' }
): Promise<RecognitionResult>;
export function recognize(
  samples: ArrayLike<number>,
  sampleRate: number,
  options: RecognitionOptions
): RecognitionResult | Promise<RecognitionResult>;
export function recognizeAsync(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: RecognitionOptions
): Promise<RecognitionResult>;
export function createRecognizer(
  options: RecognitionOptions & { sampleRate: number }
): Recognizer;
