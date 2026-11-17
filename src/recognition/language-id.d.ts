import type { LanguageCode } from '../index.js';
import type { RecognitionSound } from './ipa-to-text.js';

export interface LanguageSpan {
  language: LanguageCode;
  /** Sound indexes, excluding pauses; to is exclusive. */
  from: number;
  to: number;
  start: number | null;
  end: number | null;
  confidence: number;
}
export interface LanguageShare {
  language: LanguageCode;
  share: number;
}
export interface LanguageIdentification {
  languages: LanguageShare[];
  spans: LanguageSpan[];
  /** Mean log phone probability per sound, with the tone cue. */
  scores: Partial<Record<LanguageCode, number>>;
}
export interface LanguageIdentificationOptions {
  /** Nonempty, distinct supported codes; default all four languages. */
  languages?: LanguageCode[];
  /** Nonnegative switch cost, halved at a pause; default 6. */
  switchPenalty?: number;
  /** Scale confidence down below this many sounds; default 8. */
  minSounds?: number;
  /** Optional diagnostics, disabled by default. */
  trace?: (event: {
    units: {
      from: number;
      to: number;
      pause: boolean;
      scores: Partial<Record<LanguageCode, number>>;
    }[];
    path: LanguageCode[];
    lexicalChecks: number;
  }) => void;
}
export declare function identifyLanguage(
  ipa: string | RecognitionSound[],
  options?: LanguageIdentificationOptions
): LanguageIdentification;
export declare function languageShares(
  words: {
    language: LanguageCode;
    ipa?: string;
    from?: number;
    to?: number;
    start?: number | null;
    end?: number | null;
  }[]
): LanguageShare[];
