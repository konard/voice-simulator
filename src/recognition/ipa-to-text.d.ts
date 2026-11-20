import type { LanguageCode } from '../index.js';
import type { WhisperToneCosts } from './whisper.js';
import type { LanguageSpan } from './language-id.js';

/** One heard sound or pause, with times in seconds. */
export interface RecognitionSound {
  ipa: string;
  start: number;
  end: number;
  confidence: number;
  whispered?: true;
  voicing?: number;
  tones?: WhisperToneCosts;
}

export interface RecognitionSyllable {
  text: string;
  ipa: string;
  stress: number;
  start: number | null;
  end: number | null;
  confidence: number;
}

export interface RecognitionWord {
  text: string;
  /** Chosen pronunciation, or the heard IPA for a rule-spelled unknown. */
  ipa: string;
  language: LanguageCode;
  /** First and last heard sound; null for string input. */
  start: number | null;
  end: number | null;
  confidence: number;
  syllables: RecognitionSyllable[];
}

export interface IpaToTextOptions {
  language?: LanguageCode;
  /** Language-ID spans covering all sounds. One language behaves as language. */
  spans?: LanguageSpan[];
  /** Number of distinct texts, including the best. Default 1. */
  nbest?: number;
  /** Partial paths retained at each position. Default 32. */
  beam?: number;
  /** Spaces end words in 'given'; pauses always end words. */
  boundaries?: 'given' | 'search';
  /** Optional diagnostics; off unless supplied. */
  trace?: (event: {
    sounds: number;
    paths: number;
    cost: number;
    words: { from: number; to: number; word: string; cost: number }[];
  }) => void;
}

export interface IpaToTextResult {
  text: string;
  ipa: string;
  words: RecognitionWord[];
  alternatives?: { text: string; ipa: string; confidence: number }[];
}

/** Deterministic, count-based IPA decoding in English, Russian, Hindi or Mandarin. */
export declare function ipaToText(
  ipa: string | RecognitionSound[],
  options?: IpaToTextOptions
): IpaToTextResult;
