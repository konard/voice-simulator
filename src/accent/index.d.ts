/** Types of ./index.js (re-exported by src/index.d.ts). */

import type { AccentCode, HeadConfig, LanguageCode } from '../index.d.ts';

/** A rule of an accent (src/accent/apply.js). */
export interface AccentRule {
  /** Replace units: `{"θ": "s"}`. */
  map?: Record<string, string>;
  /** Select units by phoneme fields; `add` or `remove` a diacritic. */
  match?: Partial<
    Record<
      | 'kind'
      | 'place'
      | 'manner'
      | 'voiced'
      | 'height'
      | 'backness'
      | 'rounded',
      string | number | boolean | (string | number | boolean)[]
    >
  >;
  add?: string;
  remove?: string;
  /** A unit or a class: `#`, `V`, `C`, `voiceless`, `front`. */
  before?: string;
  after?: string;
  stress?: 'stressed' | 'unstressed';
  /** The rule runs when the strength is at least `min` (default 0). */
  min?: number;
  note?: string;
}

/** An accent file (format voice-simulator/accent, version 1). */
export interface AccentDefinition {
  format: 'voice-simulator/accent';
  version: 1;
  code: string;
  name?: string;
  language: LanguageCode;
  /** The accent applied first. */
  base?: string | null;
  /** Switches of the language's pronouncer (okanye, fricativeG, erhua, lowThird, weakForms). */
  g2p?: Record<string, boolean>;
  rules?: AccentRule[];
  phonotactics?: {
    codas?: 'any' | string[];
    maxOnset?: number;
    epenthesis?: string | null;
    prothesis?: string | null;
  } | null;
  prosody?: {
    tunes?: LanguageCode | null;
    range?: number;
    rate?: number;
    stressLengthening?: number;
  };
  /** Offsets added to head values. */
  articulation?: Partial<HeadConfig>;
}

/** An accent option: a code, a code with a strength (0 to 1) or a definition. */
export type AccentOption =
  | AccentCode
  | string
  | { code: AccentCode | string; strength?: number }
  | AccentDefinition;

export declare const ACCENT_FORMAT: 'voice-simulator/accent';
export declare const ACCENT_VERSION: 1;
export declare const MAX_ACCENT_RULES: 500;
export interface AccentSettings {
  code: string;
  level: number;
  language: LanguageCode;
  chain: AccentDefinition[];
  g2p: Record<string, boolean>;
  englishAccent: 'en-US' | 'en-GB' | 'en-AU' | 'en-IN';
  prosody: {
    tunes: LanguageCode | null;
    range: number;
    rate: number;
    stressLengthening: number;
  };
  articulation: Partial<HeadConfig>;
}
/** The definition of an accent code (a copy), or null for an unknown one. */
export declare function getAccent(code: string): AccentDefinition | null;
/** Apply an accent (with its bases) to the IPA of one word. */
export declare function applyAccent(
  wordIpa: string,
  definition: AccentDefinition | AccentCode | string,
  strength?: number
): string;
/** Which accents explain how `heardIpa` differs from `expectedIpa`, best first. */
export declare function explainAccent(
  expectedIpa: string,
  heardIpa: string,
  lang: LanguageCode
): { code: AccentCode; explained: number; total: number }[];
/** Check an accent file; throws a TypeError naming the wrong field. */
export declare function loadAccent(
  json: AccentDefinition | string
): AccentDefinition;
/** The definition of `<target>-x-<first>`: `target` with the sounds of `first`. */
export declare function foreignAccent(
  target: LanguageCode,
  first: LanguageCode
): AccentDefinition;
/** What an accent option means for a language (null for an unknown language). */
export declare function accentSettings(
  lang: string,
  value?: AccentOption,
  options?: { level?: number; lenient?: boolean }
): AccentSettings | null;
