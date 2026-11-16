/**
 * Type definitions for voice-simulator: physical 3D voice simulation.
 */

export type LanguageCode = 'en' | 'ru' | 'hi' | 'zh';
/**
 * Head parameters by key (see HEAD_PARAMETERS). The speaker habits of
 * issue 40 add to the free articulator channels in tractShape:
 * `jawPosture` (cm of incisor gap, -0.2 to 0.6), `lipPosture` (cm of lip
 * protrusion, -0.3 to 0.6, negative spreads the lips), `larynxPosture`
 * (cm, -1 to 1, negative lowers the larynx) and `tongueRootPosture`
 * (-1 to 1). Two optional couplings, off at 0, shape the pitch:
 * `intrinsicPitch` (semitones between the closest and the most open
 * vowel, 0 to 3) and `larynxPitch` (cm the larynx rises per octave above
 * the speaker pitch, 0 to 1).
 */
export type HeadConfig = Record<string, number>;
export type SolverName = 'waveguide' | 'fdtd2d' | 'fdtd3d';
/** Voice source: the LF pulse model or the physical vocal folds. */
export type SourceName = 'lf' | 'folds';
export type OutputMode = 'flow' | 'microphone';

export interface Language {
  code: LanguageCode;
  name: string;
  native: string;
  sample: string;
}

/**
 * Where a word's pronunciation came from. `heteronym`: an English word
 * spelled one way and spoken two ways (`record`, `read`), read as fits
 * the words around it.
 */
export type WordSource =
  | 'dictionary'
  | 'morphology'
  | 'rules'
  | 'heteronym'
  | 'exception'
  | 'pinyin'
  | 'unknown';

export interface Word {
  text: string;
  lang: string;
  /**
   * The word as spoken in its phrase: a Russian preposition or particle
   * (`из`, `на`, `не`, `же` ...) has the reduced, assimilated form it takes
   * next to the word it leans on (`из дома` gives ɪz, then ˈdomə).
   */
  ipa: string;
  source?: WordSource;
  /**
   * For a heteronym: the part of speech that chose its reading (`N` noun,
   * `A` adjective, `V` verb, `D` past tense or participle), or the tags of
   * the reading when a neighbouring word or the default chose it.
   */
  tag?: string;
  pinyin?: string;
  /** The written text the word was read from (before verbalisation). */
  original?: string;
  sourceStart?: number;
  sourceEnd?: number;
  token?: number;
  /** Range of the part of the token this word reads (`3` of `3/4/2024`). */
  partStart?: number;
  partEnd?: number;
  linkingR?: boolean;
}

/** Accent codes of ACCENTS (docs/accents.md). */
export type AccentCode =
  | 'en-US'
  | 'en-GB'
  | 'en-AU'
  | 'en-IN'
  | 'en-CA'
  | 'en-x-ru'
  | 'en-x-hi'
  | 'en-x-zh'
  | 'ru-RU'
  | 'ru-x-north'
  | 'ru-x-south'
  | 'ru-x-en'
  | 'ru-x-hi'
  | 'ru-x-zh'
  | 'hi-IN'
  | 'hi-x-east'
  | 'hi-x-en'
  | 'hi-x-ru'
  | 'hi-x-zh'
  | 'zh-CN'
  | 'zh-TW'
  | 'zh-x-south'
  | 'zh-x-en'
  | 'zh-x-ru'
  | 'zh-x-hi';

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

export interface Transcription {
  lang: string;
  /** Accent code of the language (en-US, en-x-ru, zh-TW, ...). */
  accent?: AccentCode | string | null;
  /** Strength of the accent, 0 to 1. */
  accentLevel?: number | null;
  ipa: string;
  words: Word[];
}

export interface TimelineSyllable {
  ipa: string;
  /** 0 unstressed, 1 primary, 2 secondary. */
  stress: number;
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
  /** Letters that spell the syllable, when the word is read as written. */
  text?: string;
  sourceStart?: number;
  sourceEnd?: number;
  /** Letters of the spoken word for this syllable, in a verbalised word. */
  spoken?: string;
  /** Index of the spoken word (into `word.spoken.split(' ')`). */
  spokenWord?: number;
  /** Range of the part of the token this spoken word reads (date, time, money, unit). */
  partStart?: number;
  partEnd?: number;
}

export interface TimelineWord {
  text: string;
  /** Spoken words joined by a space, when the word is not read as written. */
  spoken?: string;
  lang: string;
  ipa: string;
  start: number;
  end: number;
  /** Range of the source text (null when it cannot be mapped). */
  sourceStart: number | null;
  sourceEnd: number | null;
  syllables: TimelineSyllable[];
}

export interface Timeline {
  duration: number;
  words: TimelineWord[];
}

export interface Plan {
  tokens: object[];
  segments: object[];
  head: HeadConfig;
  frameRate: number;
  frameCount: number;
  duration: number;
  channels: Record<string, Float32Array>;
}

export interface Mesh {
  name?: string;
  positions: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
}

export interface AudioTier {
  name: string;
  solver: SolverName;
  sections?: number;
  dx?: number;
  sampleRate: number;
  /** Control interval in output samples (narrow-band tiers; default 32). */
  blockSize?: number;
  /**
   * Corner (Hz) of the eighth-order Butterworth output low-pass of the
   * narrow-band tiers (telephone, narrowband, wideband), applied at the
   * solver rate and again at the output rate.
   */
  bandLimit?: number;
  cost: number;
}

export interface VisualTier {
  name: string;
  meshLod: number;
  field: boolean;
  cost: number;
}

export interface RenderOptions {
  sampleRate?: number;
  sections?: number;
  solver?: SolverName | string;
  /** Voice source (default `'lf'`); unknown names throw `Unknown source`. */
  source?: SourceName;
  /**
   * Source-tract interaction (default DEFAULT_INTERACTION; folds only, CPU
   * solvers): the folds feel the waves of the vocal tract and, with
   * `subglottal` (default: as `interaction`), of the trachea. With `'lf'`
   * it throws `Interaction needs source: 'folds'`.
   */
  interaction?: boolean;
  /** Couple the subglottal tract (trachea and bronchi) under interaction. */
  subglottal?: boolean;
  seed?: string | number;
  /** Output samples between two updates of the tract (default 32). */
  blockSize?: number;
  /**
   * With a corner (Hz), the output low-pass is eighth-order Butterworth at
   * min(bandLimit, 0.45 sampleRate) instead of fourth order at
   * min(0.45 sampleRate, 20000), at the solver rate and again at the
   * output rate.
   */
  bandLimit?: number;
  head?: HeadConfig;
  dx?: number;
  model?: object;
  output?: OutputMode;
  kernel?: 'wasm' | 'js';
  /** WebGPU device for the 3D solver (render with renderAsync). */
  device?: GPUDeviceLike;
}

/** A WebGPU GPUDevice (typed loosely so the package needs no WebGPU types). */
export type GPUDeviceLike = object;

export interface SynthesizeOptions {
  lang?: 'auto' | LanguageCode;
  /** Accent of the language (code, region such as "GB", {code, strength} or definition). */
  accent?: AccentOption;
  /** Strength of the accent when the option has none, 0 to 1 (default 1). */
  accentLevel?: number;
  /** Weak, unstressed English function words inside a phrase (default true). */
  weakForms?: boolean;
  /** Treat the text as IPA. */
  ipa?: boolean;
  head?: HeadConfig | 'random';
  seed?: string | number;
  /** Speaker group for `head: 'random'`. */
  preset?: HeadPresetName;
  tier?: string | number;
  solver?: SolverName;
  /** Voice source (default `'lf'`): `'folds'` is the two-mass fold model. */
  source?: SourceName;
  /**
   * Source-tract interaction (default DEFAULT_INTERACTION; folds only, CPU
   * solvers): the folds feel the waves of the vocal tract and, with
   * `subglottal` (default: as `interaction`), of the trachea. With `'lf'`
   * it throws `Interaction needs source: 'folds'`.
   */
  interaction?: boolean;
  /** Couple the subglottal tract (trachea and bronchi) under interaction. */
  subglottal?: boolean;
  sections?: number;
  dx?: number;
  sampleRate?: number;
  /** Control interval in output samples (default: the tier's, else 32). */
  blockSize?: number;
  /** Output band limit (Hz; default: the tier's, else none). */
  bandLimit?: number;
  output?: OutputMode;
  model?: object;
  /** WebGPU device for the 3D solver (synthesizeAsync, synthesizeStream). */
  device?: GPUDeviceLike;
}

export interface SynthesisResult extends Transcription {
  head: HeadConfig;
  plan: Plan;
  timeline: Timeline;
  sampleRate: number;
  samples: Float32Array;
  duration: number;
}

// High-level API
export declare function synthesize(
  text: string,
  options?: SynthesizeOptions
): SynthesisResult;
export declare function synthesizeAsync(
  text: string,
  options?: SynthesizeOptions & { chunkSize?: number }
): Promise<SynthesisResult>;
export declare function synthesizeStream(
  text: string,
  options?: SynthesizeOptions & { chunkSize?: number }
): AsyncGenerator<Float32Array>;
export declare function prepareUtterance(
  text: string,
  options?: SynthesizeOptions
): Transcription & {
  head: HeadConfig;
  plan: Plan;
  timeline: Timeline;
  renderOptions: RenderOptions;
};
export declare function getAudioTier(
  tier: string | number | undefined | null
): AudioTier | null;

// Text to IPA
export declare const LANGUAGES: Readonly<Record<LanguageCode, Language>>;
export declare function textToIpa(
  text: string,
  options?: {
    /** A language, or a regional tag such as 'en-GB' that picks the accent. */
    lang?: 'auto' | LanguageCode | AccentCode | string;
    /**
     * Accent of the language: a code of ACCENTS, {code, strength} or a
     * definition. An unknown code of the language throws a RangeError; a
     * code of another language is ignored.
     */
    accent?: AccentOption;
    /** Strength of the accent when the option has none, 0 to 1 (default 1). */
    accentLevel?: number;
    /**
     * Speak English function words in their weak, unstressed form inside a
     * phrase (`a cup of tea for you` ə ˈkʌp əv ˈti fɚ ju). Default true.
     */
    weakForms?: boolean;
  }
): Transcription;
export declare function detectLanguage(text: string): LanguageCode;
export declare function scriptLanguage(text: string): LanguageCode | null;
export declare function parseIpa(text: string): {
  tokens: object[];
  unknown: string[];
};
export declare function formatIpa(tokens: object[]): string;
export declare function getPhoneme(symbol: string): object | undefined;
export declare function listSymbols(): string[];
export declare const VOWELS: Readonly<Record<string, object>>;
export declare const CONSONANTS: Readonly<Record<string, object>>;

// Articulation
export declare const CONTROL_RATE: number;
/** Time constant (s) of every channel of a plan. @deprecated Use ARTICULATORS. */
export declare const CHANNELS: Readonly<Record<string, number>>;
/** Dynamics of one articulation channel (seconds). */
export interface Articulator {
  /** Time constant of each of the DYNAMICS_ORDER one-pole filters. */
  timeConstant: number;
  /** The input at time t is the target active at t + lead. */
  lead: number;
  /** Bounds of the time constant for the fit. */
  min: number;
  max: number;
  /** Bounds of the lead for the fit. */
  leadMin: number;
  leadMax: number;
}
export declare const ARTICULATORS: Readonly<
  Record<string, Readonly<Articulator>>
>;
/** Lead of the lips before a rounded sound, seconds. */
export declare const ROUNDING_LEAD: number;
/** Lead of the velum before a nasal sound, seconds. */
export declare const VELUM_LEAD: number;
/** Number of cascaded one-pole filters per articulator (2 to 6). */
export declare const DYNAMICS_ORDER: number;
/**
 * How much consonants keep their own tongue-body position against the
 * line between the neighbouring vowels: `r * own + (1 - r) * line`.
 */
export declare const COARTICULATION_RESISTANCE: Readonly<{
  levels: Readonly<Record<'high' | 'medium' | 'low' | 'none', number>>;
  phones: Readonly<Record<string, string>>;
  manners: Readonly<Record<string, string>>;
  places: Readonly<Record<string, string>>;
  own: Readonly<Record<string, { height: number; backness: number }>>;
}>;
/** One target of an articulation channel; times in seconds. */
export interface ChannelTarget {
  value: number;
  start: number;
  end: number;
  /** 1 = own target, 0 = free (follows the line between own targets). */
  strength: number;
}
/** Inherent and minimum duration of a sound in milliseconds. */
export interface DurationEntry {
  inherent: number;
  minimum: number;
}
/** Duration table of one language (issue 39). */
export interface DurationTable {
  /** Per class: open, mid, close, reduced, diphthong, nasal, … */
  classes: Readonly<Record<string, DurationEntry>>;
  /** Per IPA symbol; wins over the class. */
  symbols: Readonly<Record<string, DurationEntry>>;
  /** Factors by rule name; null switches a rule off. */
  rules: Readonly<Record<string, number | null>>;
  /** Weight of the main vowel of a diphthong against 1 for the others. */
  diphthongMain: number;
  /** Factors of the closure and frication of an affricate. */
  affricate: Readonly<{ closure: number; frication: number }>;
}
/** One rule of the duration model of Klatt (1979). */
export interface DurationRule {
  name: string;
  /** Default factor (ms for `scope: 'add'`); null = off by default. */
  factor: number | null;
  /** What the factor scales (default 'percent'). */
  scope?: 'percent' | 'minimum' | 'total' | 'add';
  /** Power of the factor in a context (e.g. syllables in the word). */
  exponent?(features: DurationFeatures): number;
  /** Weighted 0.7 + 0.3 f outside a phrase-final syllable. */
  postvocalic?: boolean;
  /** Divided by stressLengthening / 1.35. */
  stress?: boolean;
  /** Only the first applying rule of a group counts. */
  group?: string;
  applies(token: object, features: DurationFeatures): boolean;
}
/** Context of one token for the duration rules. */
export interface DurationFeatures {
  stress: 0 | 1 | 2;
  emphasis: boolean;
  /** Boundary class after the syllable ('period', 'comma', …) or null. */
  phraseFinal: string | null;
  wordFinalSyllable: boolean;
  wordInitialSyllable: boolean;
  syllablesInWord: number;
  wordInitial: boolean;
  syllableOnset: boolean;
  syllableCoda: boolean;
  pretonic: boolean;
  /** Class of the previous and the next sound in the word, or null. */
  previous: string | null;
  next: string | null;
  /** Tone 1 to 5 (5 = neutral) in tonal languages, 0 otherwise. */
  tone: number;
  /** Tone 5 without stress mark: the neutral tone. */
  neutral: boolean;
  afterAspirated: boolean;
  nucleusSize: number;
  nucleusMain: boolean;
  /** Symbols of the vowels of the nucleus, e.g. 'aɪ'. */
  nucleusSymbol: string | null;
}
export interface DurationOptions {
  speechRate?: number;
  stressLengthening?: number;
  finalLengthening?: number;
}
/** Exponent of the speech rate on the minimum duration (0.5). */
export declare const RATE_MINIMUM: number;
/** Exponent of the speech rate on the stretchable part (1.2). */
export declare const RATE_STRETCH: number;
/** Exponent of the speech rate on pauses of strength 2 and more (1.5). */
export declare const RATE_PAUSE: number;
/** Default factor of the neutral tone on the whole vowel (0.6). */
export declare const NEUTRAL_DURATION: number;
export declare const DURATION_RULES: readonly DurationRule[];
/** Tables of en, ru, hi, zh and default (English). */
export declare const DURATION_TABLES: Readonly<
  Record<'en' | 'ru' | 'hi' | 'zh' | 'default', DurationTable>
>;
/** Table of a language code (`en-US` finds `en`), `default` otherwise. */
export declare function durationTable(language?: string): DurationTable;
export declare function durationFeatures(
  tokens: object[],
  index: number,
  options?: { language?: string }
): DurationFeatures | null;
/** (minimum + (inherent - minimum) * percent / 100) / rate, in seconds. */
export declare function durationFormula(values: {
  inherent: number;
  minimum: number;
  percent: number;
  speechRate?: number;
}): number;
export declare function applyingRules(
  token: object,
  features: DurationFeatures,
  table?: DurationTable,
  options?: DurationOptions
): { rule: DurationRule; factor: number }[];
/** Inherent and minimum (ms) of each part of a token. */
export declare function phonemeDurations(
  token: object,
  features: DurationFeatures,
  table?: DurationTable
): DurationEntry[];
/** Seconds per part (one, or closure and frication of an affricate). */
export declare function segmentParts(
  token: object,
  features: DurationFeatures,
  table?: DurationTable,
  options?: DurationOptions
): number[];
/** Duration of a token in seconds. */
export declare function segmentDuration(
  token: object,
  features: DurationFeatures,
  table?: DurationTable,
  options?: DurationOptions
): number;
/** Shortest duration of a token at the speech rate, in seconds. */
export declare function minimumDuration(
  token: object,
  features: DurationFeatures,
  table?: DurationTable,
  options?: DurationOptions
): number;
/** Pause in seconds: strength 2 and more shrink with speechRate ** 1.5. */
export declare function scalePause(
  base: number,
  strength: number,
  speechRate?: number
): number;
export declare const TRACT_SECTIONS: number;
export declare function planUtterance(
  ipa: string | object[],
  options?: {
    head?: HeadConfig;
    language?: string;
    frameRate?: number;
    /** Measured duration of every token in seconds (null keeps the plan's). */
    durations?: (number | null)[];
    /** Duration table (an entry of DURATION_TABLES) instead of the language's. */
    durationTable?: DurationTable;
    /** Prosody factors, duration language (`tunes`) and head offsets of an accent. */
    accent?: Pick<AccentSettings, 'prosody' | 'articulation'>;
    /** Overrides of ARTICULATORS entries, e.g. { velum: { lead: 0.1 } }. */
    articulators?: Record<string, Partial<Articulator>>;
    /** Values of the levels of COARTICULATION_RESISTANCE. */
    resistance?: Partial<Record<'high' | 'medium' | 'low' | 'none', number>>;
  }
): Plan;
export declare function channelTargets(
  segments: object[],
  name: string,
  options?: {
    resistance?: Partial<Record<'high' | 'medium' | 'low' | 'none', number>>;
  }
): ChannelTarget[];
export declare function approachTargets(
  targets: ChannelTarget[],
  timeConstant: number,
  frameRate: number,
  order?: number,
  options?: {
    lead?: number;
    limited?: boolean;
    frameCount?: number;
    fallback?: number;
  }
): Float32Array;
export {
  approachTargets as approachToneTargets,
  NEUTRAL_LEVELS,
  TONE_RATES,
  neutralLevel,
  toneCurve,
  toneIntervals,
} from './articulation/tone-model.js';
export type { ToneInterval, ToneState } from './articulation/tone-model.js';
export declare function sampleState(
  plan: Plan,
  time: number,
  target?: Record<string, number>
): Record<string, number>;
/**
 * Free articulator channels of a plan (issue 40). Left out, each takes the
 * value the other channels imply, which gives the shape of the vowel and
 * consonant channels alone.
 */
export interface ArticulatorChannels {
  /** Gap between the incisors (cm), 0.1 to 1.8; time constant 0.02 s. */
  jaw?: number;
  /**
   * Lips pushed forward (cm), -0.3 to 1.2, by default LIP_PROTRUSION times
   * the rounding; time constant 0.02 s.
   */
  lipProtrusion?: number;
  /**
   * Larynx above its place in the vowel (cm, negative lowered), -1.5 to
   * 1.5; time constant 0.04 s.
   */
  larynxHeight?: number;
  /**
   * Tongue root, -1 pulled back (narrower pharynx) to +1 pushed forward;
   * time constant 0.03 s.
   */
  tongueRoot?: number;
}
/** Lip protrusion (cm) of a fully rounded vowel. */
export declare const LIP_PROTRUSION: number;
/**
 * Resample sections of unequal `lengths` (cm) into `sections` equal ones,
 * keeping the volume of every stretch of the tract.
 */
export declare function stretchSections(
  areas: ArrayLike<number>,
  lengths: ArrayLike<number>,
  sections?: number
): { areas: Float64Array; length: number };
export declare function tractShape(
  state: Record<string, number> & ArticulatorChannels,
  head: HeadConfig,
  options?: {
    sections?: number;
    teeth?: boolean;
    /** Vowel table in place of the tube model's (see VOWEL_CORRECTIONS). */
    vowelCorrections?: Record<string, number[]>;
  }
): {
  areas: Float64Array;
  length: number;
  velumArea: number;
  velumIndex: number;
  frication: {
    position: number;
    gain: number;
    sibilance: number;
    /** How much the jet is aimed at the incisors (0..1). */
    obstacle: number;
  };
  glottis: Record<string, number>;
  /** Incisors; null with `teeth: false`. */
  teeth: Teeth | null;
  /**
   * Lateral channel (0..1): the tongue blocks the middle of the tract at
   * the constriction and the air passes beside it (2D solver only).
   */
  lateral: number;
};
export declare function noseShape(
  head: HeadConfig,
  sections?: number
): { areas: Float64Array; length: number };

// Head configuration
/** The parameter groups, in the order of the editor and of voice files. */
export type HeadGroup =
  | 'anatomy'
  | 'folds'
  | 'breathing'
  | 'articulation'
  | 'expression'
  | 'microphone';
/** Measures of tests/helpers/voice-measures.js (docs/VOICE-PARAMETERS.md). */
export type VoiceMeasure =
  | 'duration'
  | 'rms'
  | 'f0'
  | 'f0Range'
  | 'hnr'
  | 'h1h2'
  | 'centroid'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'bandwidth1'
  | 'noiseLevel'
  | 'nasalLevel'
  | 'reverb';
export interface HeadParameterEffect {
  /** The measure of the sound that moves from `min` to `max`. */
  measure: VoiceMeasure;
  /** 1: it rises, -1: it falls, 0: the model does not use the value yet. */
  sign: 1 | 0 | -1;
  /** Why a value with sign 0 does not move the sound. */
  note?: string;
  /** Utterance, tier, options and head values of the check, if not the default. */
  ipa?: string;
  tier?: string;
  options?: Record<string, unknown>;
  head?: HeadConfig;
  /** The two values compared, if not `min` and `max`. */
  values?: readonly [number, number];
}
export interface HeadParameter {
  key: string;
  label: string;
  group: HeadGroup;
  min: number;
  max: number;
  step: number;
  default: number;
  /** '1' for a plain number, 'x' for a factor. */
  unit: string;
  description: string;
  /** Citation of the default and the range, or `fitted: <experiment>`. */
  source: string;
  effect: Readonly<HeadParameterEffect>;
  /** Shown only with "Show all parameters" in the editor. */
  advanced: boolean;
}
export declare const HEAD_GROUPS: readonly HeadGroup[];
export declare const HEAD_PARAMETERS: readonly HeadParameter[];
export declare const DEFAULT_HEAD: Readonly<HeadConfig>;
export declare function normalizeHeadConfig(config?: HeadConfig): HeadConfig;
export declare function randomHeadConfig(
  seed: string | number,
  options?: { preset?: HeadPresetName }
): HeadConfig;
export declare function encodeHeadConfig(config: HeadConfig): string;
export declare function decodeHeadConfig(text: string): HeadConfig;
export declare function getHeadParameter(key: string): HeadParameter;
export declare function createRandom(seed?: string | number): () => number;
export declare function createSeed(): string;
export declare function hashSeed(value: string | number): number;

// Acoustics
export interface Solver {
  setShape(
    areas: ArrayLike<number>,
    velumArea: number,
    velumIndex?: number
  ): void;
  setNose(areas: ArrayLike<number>): void;
  /**
   * `noise` is the turbulence pressure (a dipole source) and `flow` the
   * burst transient of a stop (a flow source) at `noisePosition`.
   */
  step(
    glottalFlow: number,
    noisePosition: number,
    noise: number,
    flow?: number
  ): number;
  /** Queue a step; its output comes with the next flushSteps. */
  queueStep?(
    glottalFlow: number,
    noisePosition: number,
    noise: number,
    flow?: number
  ): void;
  flushSteps?(options?: { field?: boolean }): Promise<Float64Array>;
  /** Optional pressure snapshot for visualisation. */
  field?(): object;
  /**
   * The tract as the glottis sees it (issue 34): the wave arriving there
   * (pressure / rho c, a derivative as the source) and the area (cm²,
   * Infinity for a field solver). The object is reused.
   */
  glottalLoad?(): GlottalLoad;
  /** Reflection of the waves arriving at the glottis (1 under interaction). */
  setGlottalReflection?(reflection: number): void;
  reset(): void;
}
/** Wave arriving at the glottis and the tube area there. */
export interface GlottalLoad {
  incident: number;
  area: number;
}
export declare class VoiceRenderer {
  constructor(plan: Plan, options?: RenderOptions);
  readonly solver: Solver;
  readonly sampleRate: number;
  readonly duration: number;
  readonly done: boolean;
  readonly totalSamples: number;
  position: number;
  /** Air flow of the last control block (null before the first). */
  readonly airflow: AirflowState | null;
  /** Amplitude of the frication noise of the last control block. */
  readonly fricationAmplitude: number;
  /** Whether the folds and the tract interact (issue 34). */
  readonly interaction: boolean;
  /** The subglottal line under interaction, else null. */
  readonly subglottal: Subglottal | null;
  render(target: Float32Array): number;
  /** render() for solvers that queue their steps (the GPU solver). */
  renderAsync(
    target: Float32Array,
    options?: { field?: boolean }
  ): Promise<number>;
}
export declare function renderPlan(
  plan: Plan,
  options?: RenderOptions
): Float32Array;
export declare function renderPlanAsync(
  plan: Plan,
  options?: RenderOptions & { chunkSize?: number }
): Promise<Float32Array>;
/** Interface version of src/engine/voice-simulator.wasm (`vs_abi_version`). */
export declare const ENGINE_ABI_VERSION: number;
/** The Rust engine: the exports and the memory of the WebAssembly module. */
export interface EngineModule {
  exports: Record<string, (...args: number[]) => number>;
  memory: WebAssembly.Memory;
  abiVersion: number;
  /** Built with WebAssembly SIMD (`voice-simulator-simd.wasm`, issue 23). */
  simd: boolean;
}
/**
 * Load the Rust engine (`npm run build:wasm` builds it). `source` is a
 * WebAssembly.Module, the bytes, a URL, or nothing for the files next to
 * the loader. Without a source, `simd: 'auto'` (the default) tries
 * `voice-simulator-simd.wasm` first and falls back to
 * `voice-simulator.wasm`, `false` loads only the scalar file and `true`
 * only the SIMD file; with a source, `true` (`false`) resolves to null when
 * it is not (is) a SIMD build. Resolves to null without WebAssembly,
 * without the file or when it does not compile; throws when its interface
 * version differs.
 */
export declare function loadEngineModule(
  source?: WebAssembly.Module | BufferSource | URL | string | null,
  options?: { simd?: 'auto' | boolean }
): Promise<EngineModule | null>;
/**
 * VoiceRenderer with the waveguide (issue 22) or the 3D FDTD solver (issue
 * 23) on the Rust engine: the same samples within parity class B. Options
 * the engine does not handle (`solver` other than `'waveguide'` and
 * `'fdtd3d'`, `device`, `source: 'folds'`, `bandLimit <= 0`) throw an
 * Error with `code === 'ENGINE_UNSUPPORTED'`. With `'fdtd3d'` the voxel
 * model is `options.model`, or the one Fdtd3d builds from `dx`,
 * `microphone`, `enclosure`, `piriform` and `vallecula`. Call free() when
 * done.
 */
export declare class RustVoiceRenderer {
  constructor(module: EngineModule, plan: Plan, options?: RenderOptions);
  readonly sampleRate: number;
  readonly sections: number;
  readonly duration: number;
  readonly done: boolean;
  readonly totalSamples: number;
  position: number;
  /** Milliseconds spent preparing frames in JavaScript so far. */
  readonly prepareTime: number;
  render(target: Float32Array): number;
  renderAsync(target: Float32Array): Promise<number>;
  /**
   * Acoustic pressure per oral and nasal section; with `solver: 'fdtd3d'`,
   * `pressure` holds the pressure of every cell of the voxel model.
   */
  field(): { pressure: Float64Array; nose?: Float64Array };
  /** Free the engine memory of this renderer. */
  free(): void;
}
/** renderPlan on the Rust engine. */
export declare function renderPlanRust(
  module: EngineModule,
  plan: Plan,
  options?: RenderOptions
): Float32Array;
/**
 * A job for `voice-simulator-cli render-job`: little-endian f64 values
 * `[config length, config..., model length, model..., frame count,
 * frames..., sample count]`; the model is the packed voxel model of the 3D
 * solver (its length in bytes, 0 for the waveguide).
 */
export declare function renderJob(
  plan: Plan,
  options?: RenderOptions
): {
  config: Float64Array;
  model: Uint8Array;
  frames: Float64Array;
  frameCount: number;
  samples: number;
  bytes: Uint8Array;
};
/** A WebGPU device for the 3D solver, or null without WebGPU. */
export declare function requestGpuDevice(options?: {
  gpu?: object;
}): Promise<GPUDeviceLike | null>;
/** The adapter a device runs on (`device.adapterInfo`), or null. */
export interface GpuDeviceInfo {
  description: string;
  vendor: string;
  architecture: string;
  /** `adapterInfo.isFallbackAdapter`: a software adapter. */
  fallback: boolean;
}
export declare function describeGpuDevice(
  device: GPUDeviceLike | null | undefined
): GpuDeviceInfo | null;
export declare class FdtdGpu {
  constructor(solver: Fdtd3d, device: GPUDeviceLike);
  readonly workgroup: number;
  queue(force: number, inject: number): void;
  flush(options?: { field?: boolean }): Promise<Float64Array>;
  reset(): void;
  destroy(): void;
}
export declare function registerSolver(
  name: string,
  factory: (options: object) => Solver
): void;
export declare class Waveguide implements Solver {
  constructor(options?: {
    sections?: number;
    noseSections?: number;
    head?: HeadConfig;
    /** `false` leaves out the piriform fossae side branch. */
    piriform?: boolean;
    /**
     * Boundary-layer loss in units of a round tube's viscothermal loss
     * (LOSS_SHAPE, 1.3).
     */
    lossShape?: number;
    /** Groups of tract sections sharing one loss filter (LOSS_STAGES). */
    lossStages?: number;
    /** Radiation load: 1 a piston in a baffle, 0 a free pipe end. */
    baffle?: number;
    /** `false` makes the tract walls rigid. */
    walls?: boolean;
  });
  setShape(
    areas: ArrayLike<number>,
    velumArea: number,
    velumIndex?: number
  ): void;
  setNose(areas: ArrayLike<number>): void;
  step(
    glottalFlow: number,
    noisePosition: number,
    noise: number,
    flow?: number
  ): number;
  /** Pressure per tract and nose section, for visualisation. */
  field(): { pressure: Float64Array; nose: Float64Array };
  reset(): void;
}
/** Cell size of the 2D sheet (cm). */
export declare const SHEET_DX: number;
/** Courant number of the 2D solver. */
export declare const COURANT_2D: number;
/** Midsagittal sheet of the tract: cell depths and column areas. */
export interface Sheet {
  dx: number;
  columns: number;
  rows: number;
  /** Rest tract length of the grid (cm). */
  length: number;
  /** Depth per cell (cm), index column * rows + row; 0 is a wall. */
  h: Float64Array;
  /** Cross-sectional area per column (cm²). */
  areas: Float64Array;
  lipArea: number;
  velumColumn: number;
}
/** Build the 2D sheet of a head (cell size dx, default SHEET_DX). */
export declare function buildSheet(
  head?: HeadConfig,
  options?: { dx?: number }
): Sheet;
/**
 * 2D FDTD solver on the midsagittal sheet of the tract, with a depth per
 * cell; the nose, the piriform fossae and the vallecula are 1D lines.
 */
export declare class Fdtd2d implements Solver {
  constructor(options?: {
    head?: HeadConfig;
    /** Cell size (cm), default SHEET_DX. */
    dx?: number;
    sheet?: Sheet;
    /** `false` leaves out the piriform fossae. */
    piriform?: boolean;
    /** `false` leaves out the vallecula. */
    vallecula?: boolean;
  });
  readonly columns: number;
  readonly rows: number;
  readonly sheet: Sheet;
  /**
   * Seconds per step; with a shape the grid runs slower by its length over
   * the rest length so the formants follow the tract length.
   */
  stepDuration(shape?: { length?: number }): number;
  /** Tract length (cm) for the lip and nostril loads. */
  setLength(length: number): void;
  setShape(
    areas: ArrayLike<number>,
    velumArea: number,
    velumIndex?: number,
    teeth?: { gap: number } | null,
    shape?: object
  ): void;
  /** Set the cell depths directly (cm, index column * rows + row). */
  setDepths(depths: ArrayLike<number>): void;
  setNose(areas: ArrayLike<number>): void;
  /** `flow`, the burst transient, enters the noise plane without its DC. */
  step(
    glottalFlow: number,
    noisePosition: number,
    noise: number,
    flow?: number
  ): number;
  queueStep(
    glottalFlow: number,
    noisePosition: number,
    noise: number,
    flow?: number
  ): void;
  flushSteps(): Promise<Float64Array>;
  /** Pressure per column, per nose section and per cell. */
  field(): { pressure: Float64Array; nose: Float64Array; cells: Float64Array };
  reset(): void;
}
export declare class Fdtd3d implements Solver {
  constructor(options?: {
    head?: HeadConfig;
    dx?: number;
    model?: object;
    output?: OutputMode;
    microphone?: MicrophoneOptions;
    enclosure?: EnclosureOptions;
    kernel?: 'wasm' | 'js';
    /** Run the step loop on this WebGPU device (queueStep/flushSteps). */
    device?: GPUDeviceLike;
    /** `false` leaves out the piriform fossae. */
    piriform?: boolean;
    /** `false` leaves out the vallecula. */
    vallecula?: boolean;
    /**
     * The source plane goes where the tract is `shape.length / lengthScale`
     * cm long (default 1; voice.js passes the mean length ratio of the 3D
     * vowel table, about 0.84).
     */
    lengthScale?: number;
  });
  /** The GPU step loop, with a `device`. */
  readonly gpu: FdtdGpu | null;
  /** Whole cells the source plane sits above the rest glottis. */
  readonly rise: number;
  /** Length (cm) from the source plane to the lips. */
  readonly activeLength: number;
  /** Distance of the receiver from the lips (cm), with a microphone. */
  readonly microphoneDistance?: number;
  /** True when the grid contains the enclosure walls. */
  readonly simulatesEnclosure: boolean;
  /**
   * Seconds per step; with a shape the grid runs slower by its length over
   * the active length (under half a cell apart once setShape has placed
   * the source plane for it).
   */
  stepDuration(shape?: { length?: number }): number;
  /**
   * With `shape`, the source plane moves to the whole cell of the voxel
   * tract (which goes on below the glottis by a quarter of its length)
   * nearest to its length, with a hysteresis of 0.15 cells, and the areas
   * map onto the part between the source plane and the lips.
   */
  setShape(
    areas: ArrayLike<number>,
    velumArea: number,
    velumIndex?: number,
    teeth?: { gap: number } | null,
    shape?: { length?: number }
  ): void;
  setNose(areas: ArrayLike<number>): void;
  step(
    glottalFlow: number,
    noisePosition: number,
    noise: number,
    flow?: number
  ): number;
  queueStep(
    glottalFlow: number,
    noisePosition: number,
    noise: number,
    flow?: number
  ): void;
  /** With `field` on the GPU, field() holds the RMS over these steps. */
  flushSteps(options?: { field?: boolean }): Promise<Float64Array>;
  /** Pressure field for visualisation. */
  field(): {
    positions: Float32Array;
    pressure: Float64Array;
    kinds: Uint8Array;
  };
  reset(): void;
}
export declare function buildVoxelModel(
  head: HeadConfig,
  options?: {
    dx?: number;
    radiationRadius?: number;
    enclosure?: EnclosureOptions;
    /** `false` leaves out the piriform fossae. */
    piriform?: boolean;
    /** `false` leaves out the vallecula. */
    vallecula?: boolean;
  }
): object;
/** Options of the LF glottal source. */
export interface GlottisOptions {
  seed?: string | number;
  tenseness?: number;
  breathiness?: number;
  /** Standard deviation of the period (%). */
  jitter?: number;
  /** Standard deviation of the amplitude (%). */
  shimmer?: number;
  aspirationLevel?: number;
  /** Area of the glottal chink (mm²). */
  chink?: number;
  /** Lung pressure (Pa) used when the control gives none (default 800). */
  lungPressure?: number;
}
/** Control channels of one Glottis.step. */
export interface GlottisControl {
  f0: number;
  voicing: number;
  aspiration: number;
  closure: number;
  loudness: number;
  /** Lung pressure (Pa); default the option times loudness^(2/3). */
  lungPressure?: number;
  /**
   * Relative turbulence strength at the glottis from the air flow; without
   * it the glottis assumes an open tract at `lungPressure`.
   */
  aspirationStrength?: number;
  /** Pressure in the mouth (dyn/cm²); the LF source does not use it. */
  oralPressure?: number;
}
/** Breath noise per 10 mm² of glottal chink. */
export declare const CHINK_NOISE: number;
/** Breath noise: BREATH_GAIN * breathiness ** BREATH_EXPONENT. */
export declare const BREATH_GAIN: number;
export declare const BREATH_EXPONENT: number;
export declare class Glottis {
  constructor(options?: GlottisOptions);
  step(dt: number, control: GlottisControl, noise: number): number;
}
/** One step of Aerodynamics (cgs: cm², cm³/s, dyn/cm²). */
export interface AirflowState {
  flow: number;
  /** cm³/s² */
  flowDerivative: number;
  /** Pressure in the mouth. */
  oralPressure: number;
  glottalDrop: number;
  constrictionDrop: number;
}
/**
 * Air flow through the glottis and the narrowest place of the mouth in
 * series; the mouth pressure follows its steady state with the lag of the
 * oral compliance.
 */
export declare class Aerodynamics {
  constructor(options?: { compliance?: number });
  compliance: number;
  oralPressure: number;
  flow: number;
  reset(): void;
  step(
    dt: number,
    lungPressure: number,
    glottalArea: number,
    constrictionArea: number
  ): AirflowState;
}
/** cm⁵/dyn */
export declare const ORAL_COMPLIANCE: number;
/** cm²/s */
export declare const VISCOSITY: number;
export declare const RE_CRITICAL: number;
/** Glottal areas (cm²) of modal voicing, an open glottis, a breathy voice. */
export declare const GLOTTIS_VOICED: number;
export declare const GLOTTIS_OPEN: number;
export declare const GLOTTIS_BREATHY: number;
export declare const REFERENCE_LUNG_PRESSURE: number;
export declare const REFERENCE_GLOTTIS: number;
export declare const REFERENCE_CONSTRICTION: number;
/** Units of the relative frication and aspiration strengths. */
export declare const FRICATION_REFERENCE: number;
export declare const ASPIRATION_REFERENCE: number;
export declare function reynolds(flow: number, area: number): number;
/** dp^1.5 A^0.5, gated by the Reynolds number. */
export declare function sourceStrength(
  dp: number,
  area: number,
  flow: number
): number;
export declare function steadyFlow(
  lungPressure: number,
  glottalArea: number,
  constrictionArea: number
): { oralPressure: number; flow: number };
export declare function openTractStrength(
  lungPressure: number,
  glottalArea: number
): number;
export declare function glottalArea(
  control: { voicing: number; aspiration: number; closure?: number },
  breathiness?: number,
  chink?: number
): number;
/**
 * 1 - exp(-x) of a first-order lag over x time constants, as a rational
 * function that gives the same bits on every runtime.
 */
export declare function lagFactor(x: number): number;
/** Amplitude of the frication noise at relative strength 1. */
export declare const FRICATION_GAIN: number;
/** Wall source against the obstacle source of a sibilant (-15 dB). */
export declare const WALL_SOURCE: number;
export declare const STROUHAL: number;
/** Gain of the burst transient (flow derivative to flow source). */
export declare const TRANSIENT_GAIN: number;
/** Peak frequency (Hz, 500 to 6000) of the noise of a jet. */
export declare function strouhalFrequency(flow: number, area: number): number;
export declare const DEFAULT_SOURCE: SourceName;
/** Source-tract interaction of VoiceRenderer when none is asked for. */
export declare const DEFAULT_INTERACTION: boolean;
/** Pressure coefficient k_t of the glottis (Bernoulli plus exit loss). */
export declare const GLOTTAL_PRESSURE_COEFFICIENT: number;
/** Corner (Hz) of the leaky integrator of IncidentPressure. */
export declare const PRESSURE_CORNER: number;
/**
 * Glottal flow (cm³/s) of the interactive source (Titze 2008) through an
 * area `a` (cm²) between tubes of areas A_s and A_e (cm², Infinity for
 * none) at the drive D = (P_L - P_o) / 2 + p_s - p_e (dyn/cm²).
 */
export declare function interactiveFlow(
  a: number,
  subglottalArea: number,
  supraglottalArea: number,
  drive: number
): number;
/** Leaky integrator from incident waves (derivatives) to pressure. */
export declare class IncidentPressure {
  constructor();
  /** Pressure (dyn/cm²) after the step of a wave (pressure / rho c). */
  step(wave: number, dt: number): number;
  readonly pressure: number;
  reset(): void;
}
/** Trachea length (cm) and area (cm²) at a 16.5 cm vocal tract. */
export declare const TRACHEA_LENGTH: number;
export declare const TRACHEA_AREA: number;
/** Bronchi length (cm) and the area (cm²) they widen to. */
export declare const BRONCHI_LENGTH: number;
export declare const BRONCHI_AREA: number;
/** Wall loss of the subglottal tract relative to the vocal tract. */
export declare const SUBGLOTTAL_LOSS: number;
/** The subglottal line runs this many times slower than the tract. */
export declare const SUBGLOTTAL_DECIMATION: number;
/** Lengths (cm) and the area (cm²) at a distance below the glottis. */
export declare function subglottalShape(head?: HeadConfig): {
  trachea: number;
  bronchi: number;
  length: number;
  area(distance: number): number;
};
/** The trachea and bronchi as a Kelly-Lochbaum line (issue 34). */
export declare class Subglottal {
  constructor(head?: HeadConfig, dt?: number);
  /** Set the step (s) of the tract solver. */
  configure(dt: number): void;
  /** Advance one tract step with the flow (derivative) entering it. */
  step(flowIn: number): void;
  /** Wave arriving at the glottis from below (pressure / rho c). */
  readonly incident: number;
  /** Area (cm²) at the glottis. */
  readonly area: number;
  reset(): void;
}
/** Controls of one VocalFolds step (pressure in Pa). */
export interface FoldControl {
  voicing: number;
  aspiration: number;
  closure: number;
  loudness: number;
  lungPressure: number;
  adduction: number;
  foldTension: number;
  /** Relative turbulence strength at the glottis from the air flow. */
  aspirationStrength?: number;
  /** Mean pressure above the glottis (dyn/cm²), used with a load. */
  oralPressure?: number;
}
/** Pressure (dyn/cm²) and area (cm², Infinity for none) of a tube end. */
export interface FoldLoadSide {
  pressure: number;
  area: number;
}
/** Waves arriving at the glottis from below and above (interaction). */
export interface FoldLoad {
  below: FoldLoadSide;
  above: FoldLoadSide;
}
/**
 * Two-mass model of the vocal folds (Steinecke and Herzel 1995) driven by
 * the lung pressure; `step` returns the scaled flow derivative.
 */
export declare class VocalFolds {
  constructor(options?: {
    breathiness?: number;
    aspirationLevel?: number;
    foldLength?: number;
    foldMass?: number;
    foldStiffness?: number;
    foldDamping?: number;
    /** Inner step rate (Hz, default FOLD_RATE). */
    rate?: number;
  });
  /**
   * Advance by dt (s); with a `load` the flow solves the interaction
   * equation of Titze (2008) (interactiveFlow) and the forces use the
   * pressures below and above the glottis.
   */
  step(
    dt: number,
    control: FoldControl,
    noise: number,
    load?: FoldLoad
  ): number;
  reset(): void;
  /** Glottal flow after the last step (cm³/s). */
  readonly flow: number;
  /** Area between the folds after the last step (cm²). */
  area: number;
  /** Low-passed `area` (MEAN_AREA_STAGES stages of MEAN_AREA_TIME), zero under a glottal closure (cm²). */
  meanArea: number;
  intensity: number;
  noiseModulation: number;
}
export declare const FOLD_RATE: number;
/** Time constant (s) of each stage of VocalFolds.meanArea. */
export declare const MEAN_AREA_TIME: number;
/** One-pole stages of VocalFolds.meanArea. */
export declare const MEAN_AREA_STAGES: number;
export declare const FOLDS_FLOW_SCALE: number;
export declare const MIN_FOLD_TENSION: number;
export declare const MAX_FOLD_TENSION: number;
/** [adduction, rest area in cm²] pairs. */
export declare const ADDUCTION_TABLE: ReadonlyArray<readonly [number, number]>;
/** Rest area of the glottis (cm²) for an adduction from 0 to 1. */
export declare function restArea(adduction: number): number;
/** Pitch (Hz) of a flow from its upward crossings of the mean. */
export declare function flowPitch(
  flow: ArrayLike<number>,
  sampleRate: number
): number;
/** Simulated pitch (Hz) of the folds at a lung pressure (Pa) and tension. */
export declare function foldPitch(
  pressure: number,
  tension: number,
  head?: HeadConfig,
  options?: {
    duration?: number;
    window?: number;
    adduction?: number;
    rate?: number;
  }
): number;
/** Fold tension Q that gives `f0` (Hz) at a lung pressure (Pa) for a head. */
export declare function tensionForPitch(
  f0: number,
  lungPressure: number,
  head?: HeadConfig
): number;
/** Side branch of a tube: a blind tube, or a Helmholtz resonator with `volume`. */
export interface TubeBranch {
  /** Section in front of which the branch joins. */
  index: number;
  /** cm² */
  area: number;
  /** cm */
  length: number;
  /** cm³ of the cavity behind the neck. */
  volume?: number;
  loss?: number;
}
/** Chain-matrix tube model options (tubeFormants and tubeSpectrum). */
export interface TubeOptions {
  /** Wall loss, mass, resistance and stiffness of the head (losses.js). */
  head?: HeadConfig;
  /**
   * Constant loss coefficient: the loss sqrt(f / area) of earlier
   * versions instead of the viscothermal loss.
   */
  loss?: number;
  /** Viscothermal loss in units of a round tube's (LOSS_SHAPE). */
  lossShape?: number;
  /** `false` makes the walls rigid. */
  walls?: boolean;
  /** Radiation load: 1 a piston in a baffle, 0 a free pipe end. */
  baffle?: number;
  /** `false` leaves out the constriction loss of the waveguide. */
  constriction?: boolean;
  branches?: TubeBranch[];
  /**
   * Nasal tract joined in front of section `velumIndex` through a port of
   * `velumArea` cm² that replaces its first section, radiating from the
   * nostrils.
   */
  nose?: {
    areas: ArrayLike<number>;
    length: number;
    velumArea: number;
    velumIndex: number;
    loss?: number;
    branches?: TubeBranch[];
  };
  /**
   * Radiated flow with a nose: lips plus nostrils (default) or either;
   * 'pressure' is the pressure in section `probe` (no nose).
   */
  output?: 'both' | 'lips' | 'nostrils' | 'pressure';
  probe?: number;
  /** Frequency step (Hz) of the spectrum. */
  step?: number;
  maxFrequency?: number;
  /** Number of formants. */
  count?: number;
}
export declare function tubeFormants(
  areas: ArrayLike<number>,
  length: number,
  options?: TubeOptions
): number[];
export declare function tubeSpectrum(
  areas: ArrayLike<number>,
  length: number,
  options?: TubeOptions
): { frequencies: Float64Array; magnitudes: Float64Array };
/** Viscothermal loss of the tract walls in units of a round tube's. */
export declare const LOSS_SHAPE: number;
/** Groups of waveguide sections that share one loss filter and wall. */
export declare const LOSS_STAGES: number;
/** Radiation load between a free pipe end (0) and a piston in a baffle (1). */
export declare const RADIATION_BAFFLE: number;
/**
 * Formant bandwidth (Hz) at `frequency` after Hawks & Miller (1995), for a
 * fundamental `f0` (132 Hz).
 */
export declare function publishedBandwidth(
  frequency: number,
  f0?: number
): number;
/**
 * Viscothermal loss (nepers per cm) of a tube of `area` cm² at
 * `frequency`, times `shape` (1 for a round tube).
 */
export declare function viscothermalLoss(
  frequency: number,
  area: number,
  shape?: number
): number;
/** Magnitude spectrum of an impulse response on a regular grid (Goertzel). */
export declare function impulseSpectrum(
  response: ArrayLike<number>,
  sampleRate: number,
  options?: { from?: number; to?: number; step?: number }
): { frequencies: Float64Array; magnitudes: Float64Array };
/** Peaks of a magnitude spectrum above `from` Hz and their -3 dB widths. */
export declare function resonances(
  spectrum: { frequencies: ArrayLike<number>; magnitudes: ArrayLike<number> },
  options?: { count?: number; from?: number }
): { frequency: number; bandwidth: number }[];
export declare function estimateFormants(
  samples: Float32Array,
  sampleRate: number,
  options?: object
): number[];
export declare function estimatePitch(
  samples: Float32Array,
  sampleRate: number,
  options?: object
): number;
export declare function rms(
  samples: ArrayLike<number>,
  start?: number,
  end?: number
): number;
/** Peak frequencies (Hz) of the magnitude spectrum of an impulse response. */
export declare function spectralPeaks(
  response: ArrayLike<number>,
  sampleRate: number,
  options?: { from?: number; to?: number; step?: number; floor?: number }
): number[];

// Audio files
export declare function encodeWav(
  samples: AudioSamples,
  sampleRate: number,
  options?: SampleEncoding
): Uint8Array;
export declare function decodeWav(bytes: Uint8Array): DecodedAudio;
export declare function wavHeader(
  sampleRate: number,
  dataLength?: number,
  channels?: number,
  options?: SampleEncoding
): Uint8Array;

// Geometry
export interface Path {
  points: Float32Array;
  count: number;
  sectionLength: number;
}
export declare const MESH_LODS: readonly object[];
export declare function headLandmarks(
  head?: HeadConfig
): Record<string, number[]>;
export declare function tractCenterline(
  head?: HeadConfig,
  options?: { sections?: number; length?: number }
): Path;
export declare function nasalCenterline(
  head: HeadConfig,
  options: {
    sections?: number;
    velumDistance: number;
    length: number;
    tractLength?: number;
  }
): Path;
export declare function headMesh(
  head?: HeadConfig,
  options?: { lod?: number }
): Mesh;
export interface TubeOptions {
  lod?: number;
  head?: HeadConfig;
  /** Lateral and midsagittal semi-axes (cm) of a section. */
  axes?: (area: number, position: number) => number[];
}
export declare const NOSE_ASPECT: number;
export declare function noseAxes(area: number): number[];
export declare function sectionAxes(
  area: number,
  position: number,
  head?: HeadConfig
): number[];
export declare function tractAxes(
  head: HeadConfig,
  restAreas: ArrayLike<number>
): (area: number, position: number) => number[];
export declare function tubeMesh(
  path: Path,
  areas: ArrayLike<number>,
  options?: TubeOptions
): Mesh;
export declare function updateTubeMesh(
  mesh: Mesh,
  path: Path,
  areas: ArrayLike<number>,
  options?: TubeOptions
): Mesh;
/** Columns across the mouth and points around each lip section per LOD. */
export declare const LIP_LODS: readonly { columns: number; ring: number }[];
/** Semi-axes (cm) of the lip opening for an area (cm²) and rounding 0..1. */
export declare function lipOpening(
  area: number,
  rounding: number,
  head: HeadConfig
): [number, number];
/** Upper and lower lip; the vertex count depends only on `lod`. */
export declare function lipsMesh(
  head?: HeadConfig,
  options?: { area?: number; rounding?: number; lod?: number }
): Mesh;
export declare function deformJaw(
  base: Float32Array,
  target: Float32Array,
  head: HeadConfig,
  openness: number
): Float32Array;
export declare function meshesToObj(meshes: Mesh[]): string;
export declare function headModel(
  head: HeadConfig,
  options?: {
    lod?: number;
    state?: Record<string, number>;
    /** Articulators from registered sources (see composeAnatomy). */
    anatomy?: AnatomySelection;
    /** Scale the sources to the head. */
    scale?: boolean;
  }
): (Mesh & { name: string })[];
export declare function headModelObj(
  head: HeadConfig,
  options?: { lod?: number; state?: Record<string, number> }
): string;
/** Binary glTF 2.0 of the whole head model, in metres. */
export declare function headModelGlb(
  head: HeadConfig,
  options?: { lod?: number; state?: Record<string, number> }
): Uint8Array;
/** Part colours (sRGB integers), roughness and opacity of the glTF export. */
export declare const PART_MATERIALS: Readonly<
  Record<string, { color: number; roughness: number; opacity?: number }>
>;
export declare function vertexNormals(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>
): Float32Array;
/** Binary glTF 2.0; `scale` defaults to 0.01 (centimetres to metres). */
export declare function meshesToGlb(
  meshes: (Mesh & { name: string })[],
  options?: { scale?: number; generator?: string }
): Uint8Array;
export declare function parseGlb(bytes: Uint8Array): {
  json: Record<string, unknown>;
  meshes: (Mesh & { name: string; normals: Float32Array })[];
};

// Levels of detail
export declare const AUDIO_TIERS: readonly AudioTier[];
/** Name of the tier used when no tier or solver is given ('studio', 3D). */
export declare const DEFAULT_AUDIO_TIER: string;
/** Index of a tier in AUDIO_TIERS; throws `Unknown audio tier: <name>`. */
export declare function audioTierIndex(name: string): number;
/**
 * Index of `minimal`: where automatic quality starts. The narrow-band tiers
 * (telephone, narrowband, wideband) lie below it.
 */
export declare const BASE_AUDIO_LEVEL: number;
export declare const VISUAL_TIERS: readonly VisualTier[];
export declare class LodGovernor<T extends { cost: number } = AudioTier> {
  constructor(options?: {
    tiers?: readonly T[];
    level?: number;
    target?: number;
    smoothing?: number;
    margin?: number;
    dwell?: number;
    maxLevel?: number;
  });
  level: number;
  load: number;
  readonly tier: T;
  predict(level: number): number;
  record(busy: number, budget: number): boolean;
}
/**
 * Pick the most detailed tier that fits the target. Tiers predicted to
 * need more than `skip` (default 2) times the target are not measured.
 */
export declare function chooseTier<T>(
  measure: (tier: T, options: { limit: number }) => number,
  options?: ChooseTierOptions<T>
): TierChoice;
/** chooseTier with an asynchronous `measure` (tiers measured on the GPU). */
export declare function chooseTierAsync<T>(
  measure: (tier: T, options: { limit: number }) => Promise<number> | number,
  options?: ChooseTierOptions<T>
): Promise<TierChoice>;
/**
 * chooseTierAsync on the CPU, then on the GPU (when `gpu`) for the
 * accelerated tiers (3D by default) above the CPU's choice.
 */
export declare function chooseTierWithGpu<T>(
  measure: (
    tier: T,
    options: { limit: number; gpu: boolean }
  ) => Promise<number> | number,
  options?: ChooseTierOptions<T> & {
    gpu?: boolean;
    accelerated?: (tier: T) => boolean;
  }
): Promise<GpuTierChoice>;
export interface GpuTierChoice extends TierChoice {
  /** Whether the chosen tier runs on the GPU. */
  gpu: boolean;
  /** Load of each tier on the GPU, null where not measured there. */
  gpuLoads: (number | null)[];
}
export interface ChooseTierOptions<T> {
  tiers?: readonly T[];
  target?: number;
  skip?: number;
}
export interface TierChoice {
  level: number;
  loads: number[];
  measured: boolean[];
}
/** Most detailed tier below `level` predicted to fit `target`. */
export declare function fallbackLevel(
  tiers: readonly { cost: number }[],
  level: number,
  load: number,
  target?: number
): number;
/** Detects in the first moments of an utterance that a tier is too slow. */
export declare class OverloadDetector {
  constructor(options?: {
    threshold?: number;
    minAudio?: number;
    maxAudio?: number;
  });
  readonly load: number;
  record(busy: number, audio: number): boolean;
}
/**
 * Load of a tier; stops early once the load exceeds `limit`. With
 * `repeats` (default 1) the median of that many measurements.
 */
export declare function measureAudioTier(
  tier: AudioTier,
  options?: {
    head?: HeadConfig;
    ipa?: string;
    seconds?: number;
    limit?: number;
    repeats?: number;
  }
): number;
export declare function benchmarkAudioTiers(options?: {
  target?: number;
  head?: HeadConfig;
  seconds?: number;
  repeats?: number;
  /** Seconds spent rendering the cheap tiers before measuring (default 0). */
  warmUp?: number;
}): {
  level: number;
  tier: AudioTier;
  loads: number[];
  measured: boolean[];
};
/**
 * measureAudioTier on the backend the app would use: with a WebGPU
 * `device` the 3D tiers run on the GPU, `chunk` samples per dispatch.
 */
export declare function measureAudioTierAsync(
  tier: AudioTier,
  options?: {
    head?: HeadConfig;
    ipa?: string;
    seconds?: number;
    limit?: number;
    device?: GPUDeviceLike | null;
    chunk?: number;
  }
): Promise<number>;
/** benchmarkAudioTiers with the 3D tiers on a WebGPU `device` when given. */
export declare function benchmarkAudioTiersAsync(options?: {
  target?: number;
  head?: HeadConfig;
  seconds?: number;
  device?: GPUDeviceLike | null;
}): Promise<GpuTierChoice & { tier: AudioTier }>;

// Audio formats (issue 5)
/** One channel, or a list of equally long channels (interleaved on write). */
export type AudioSamples = ArrayLike<number> | ArrayLike<number>[];
/** Integer PCM (8/16/24/32 bits, default 16) or float (32/64 bits). */
export interface SampleEncoding {
  bitDepth?: number | string;
  float?: boolean;
}
/** Decoded file, mixed down to mono. */
export interface DecodedAudio {
  sampleRate: number;
  samples: Float32Array;
  /** Channels in the file before mixdown. */
  channels: number;
  bitDepth: number;
  float: boolean;
}
export type AudioFormatName = 'wav' | 'flac' | 'aiff' | 'au' | 'raw';
export interface AudioFormat {
  name: AudioFormatName;
  label: string;
  extension: string;
  extensions: readonly string[];
  mimeType: string;
  bitDepths: readonly number[];
  floatBitDepths: readonly number[];
  lossless: boolean;
  /** Can be sent before the length is known (audioStreamEncoder). */
  streamable: boolean;
  encode(
    samples: AudioSamples,
    sampleRate: number,
    options?: SampleEncoding
  ): Uint8Array;
  decode(bytes: Uint8Array): DecodedAudio;
}
export interface AudioEncodingOptions extends SampleEncoding {
  format?: AudioFormatName | string;
}
export declare const AUDIO_FORMATS: Readonly<
  Record<AudioFormatName, AudioFormat>
>;
export declare const AUDIO_FORMAT_NAMES: readonly AudioFormatName[];
export declare function audioFormat(name?: string): AudioFormat;
export declare function audioEncoding(options?: AudioEncodingOptions): {
  format: AudioFormat;
  bitDepth: number;
  float: boolean;
};
export declare function encodeAudio(
  samples: AudioSamples,
  sampleRate: number,
  options?: AudioEncodingOptions
): Uint8Array;
export declare function decodeAudio(
  bytes: Uint8Array | ArrayBuffer,
  options?: AudioEncodingOptions & { sampleRate?: number; channels?: number }
): DecodedAudio & { format: AudioFormatName };
export declare function detectAudioFormat(
  bytes: Uint8Array
): 'wav' | 'aiff' | 'au' | 'flac' | null;
export declare function formatFromFileName(
  fileName: string
): AudioFormatName | null;
export declare function audioStreamEncoder(
  format: 'wav' | 'au' | 'raw' | string,
  sampleRate: number,
  options?: SampleEncoding
): {
  format: AudioFormatName;
  mimeType: string;
  header: Uint8Array;
  encode(samples: ArrayLike<number>): Uint8Array;
};
export declare function encodeAiff(
  samples: AudioSamples,
  sampleRate: number,
  options?: SampleEncoding
): Uint8Array;
export declare function decodeAiff(bytes: Uint8Array): DecodedAudio;
export declare function encodeAu(
  samples: AudioSamples,
  sampleRate: number,
  options?: SampleEncoding
): Uint8Array;
export declare function decodeAu(bytes: Uint8Array): DecodedAudio;
export declare function auHeader(
  sampleRate: number,
  dataLength?: number,
  channels?: number,
  options?: SampleEncoding
): Uint8Array;
/** Lossless FLAC, 8/16/24-bit integer samples only. */
export declare function encodeFlac(
  samples: AudioSamples,
  sampleRate: number,
  options?: { bitDepth?: number | string }
): Uint8Array;
export declare function decodeFlac(bytes: Uint8Array): DecodedAudio;
/** Headerless little-endian samples (s8, s16le, s24le, s32le, f32le, f64le). */
export declare function encodeRaw(
  samples: AudioSamples,
  sampleRate?: number,
  options?: SampleEncoding
): Uint8Array;
export declare function decodeRaw(
  bytes: Uint8Array,
  options?: SampleEncoding & { sampleRate?: number; channels?: number }
): DecodedAudio;
export {
  createStreamResampler,
  resample,
  type StreamResampler,
} from './audio/resample.js';

// Anatomy (issue 5): teeth, tongue, hard and soft palate, piriform fossae.
export interface RenderOptions {
  /** `false` leaves out the incisors. */
  teeth?: boolean;
  /** `false` leaves out the piriform fossae (both solvers). */
  piriform?: boolean;
  /** `false` leaves out the vallecula (3D FDTD). */
  vallecula?: boolean;
}
export interface Teeth {
  /** Inter-incisor gap (cm). */
  gap: number;
  /** Open area between the incisal edges (cm²). */
  area: number;
  /** Span along the tract from the glottis (cm). */
  start: number;
  end: number;
  /** Section most covered by the teeth. */
  index?: number;
  /** First section in front of the teeth. */
  outlet?: number;
}
export declare const INCISOR_THICKNESS: number;
export declare const REST_GAP: number;
export declare const SIBILANT_GAP: number;
export declare function incisorDepth(head: HeadConfig): number;
export declare function teethWidth(head: HeadConfig): number;
export declare function teethGap(
  state: Record<string, number>,
  head: HeadConfig
): number;
export declare function dentition(
  state: Record<string, number>,
  head: HeadConfig,
  length: number
): Teeth;
export declare function carveTeeth(
  areas: Float64Array,
  teeth: Teeth,
  length: number
): number;
export declare function arcPoint(
  distance: number,
  layout: { pharynx: number; bend: number; origin: number[] }
): { point: number[]; tangent: number[] };
export interface AnatomyLod {
  arch: number;
  profile: number;
  tongue: number;
  across: number;
  velum: number;
}
export interface AnatomyOptions {
  lod?: number;
  state?: Record<string, number>;
  /** Precomputed tractShape(state, head). */
  shape?: object;
}
export declare const ANATOMY_LODS: readonly AnatomyLod[];
export declare function jawAngle(gap: number, head: HeadConfig): number;
export declare function jawOpenness(gap: number, head: HeadConfig): number;
export declare function incisorEdges(
  gap: number,
  head: HeadConfig
): { upper: number[]; lower: number[] };
export declare function upperTeethMesh(
  head: HeadConfig,
  options?: { lod?: number }
): Mesh;
export declare function lowerTeethMesh(
  head: HeadConfig,
  options?: { lod?: number; gap?: number }
): Mesh;
export declare function tongueMesh(
  head: HeadConfig,
  options?: AnatomyOptions
): Mesh;
export declare function palateMesh(
  head: HeadConfig,
  options?: { lod?: number }
): Mesh;
export declare function velumMesh(
  head: HeadConfig,
  options?: { lod?: number; velum?: number }
): Mesh;
export declare function anatomyMeshes(
  head: HeadConfig,
  options?: AnatomyOptions
): (Mesh & { name: string })[];
/** Pivot (cm), angle (radians) and point motion of the jaw for a gap. */
export declare function jawPose(
  gap: number,
  head: HeadConfig
): {
  pivot: number[];
  angle: number;
  move: (point: number[]) => number[];
};

// Anatomy from other 3D sources, switched part by part
export type AnatomyPart =
  | 'upperTeeth'
  | 'lowerTeeth'
  | 'tongue'
  | 'palate'
  | 'velum';
/** A segmented 3D dataset: one mesh per part (mm) and its key points. */
export interface AnatomySource {
  readonly name: string;
  readonly citation: string;
  readonly license: string;
  readonly parts: Partial<Record<AnatomyPart, Mesh>>;
  readonly keyPoints: Record<string, number[]>;
  /** Distance (mm) between the upper first molars' occlusal points. */
  readonly archWidth: number;
}
/** One source for every part it has, or a source per part. */
export type AnatomySelection =
  | string
  | AnatomySource
  | Partial<Record<AnatomyPart, string | AnatomySource>>;
export interface RigidTransform {
  rotation: number[][];
  translation: number[];
  scale?: number;
}
export declare const ANATOMY_PARTS: readonly AnatomyPart[];
export declare const DENTAL_KEY_POINTS: readonly string[];
export declare const PROCEDURAL: 'procedural';
/** Vertex clustering cube (mm) per anatomy LOD; 0 keeps every vertex. */
export declare const SOURCE_LOD_CELLS: readonly number[];
export declare function anatomySource(
  name: string,
  meshes: Mesh[],
  options?: {
    roles?: Record<string, (name: string) => boolean>;
    keyPoints?: Record<string, number[]>;
    citation?: string;
    license?: string;
  }
): AnatomySource;
export declare function anatomySourceFromGlb(
  name: string,
  bytes: ArrayBuffer | Uint8Array,
  options?: {
    scale?: number;
    mirror?: boolean;
    roles?: Record<string, (name: string) => boolean>;
    citation?: string;
    license?: string;
  }
): AnatomySource;
export declare function registerAnatomySource(
  source: AnatomySource
): AnatomySource;
export declare function unregisterAnatomySource(name: string): boolean;
export declare function anatomySourceNames(): string[];
export declare function anatomySourceParts(): Record<string, AnatomyPart[]>;
export declare function anatomySelection(
  selection?: AnatomySelection
): Partial<Record<AnatomyPart, AnatomySource>>;
export declare function similarityFit(
  source: number[][],
  target: number[][]
): RigidTransform & { scale: number };
export declare function fitAnatomySource(
  source: AnatomySource,
  head: HeadConfig,
  options?: { fit?: string[]; scale?: boolean }
): RigidTransform;
export declare function composeAnatomy(
  head: HeadConfig,
  options?: AnatomyOptions & {
    anatomy?: AnatomySelection;
    scale?: boolean;
    fit?: string[];
  }
): (Mesh & { name: string; source: string })[];
/** Head whose mouthWidth gives the source's intermolar arch width. */
export declare function sourceHead(
  head: HeadConfig,
  source: string | AnatomySource
): HeadConfig;
/** Mesh with its vertices clustered into cubes of `cell`. */
export declare function clusterVertices(mesh: Mesh, cell: number): Mesh;

/** The HuBMAP HRA Visible Human mouth and larynx (CC BY 4.0). */
export declare const HRA: {
  readonly name: string;
  readonly citation: string;
  readonly license: string;
  readonly urls: { readonly male: string[]; readonly female: string[] };
  readonly units: string;
};
/** HRA meshes in millimetres, head frame, fetched just in time. */
export declare function fetchHra(
  sex: 'male' | 'female',
  options?: { fetchFn?: typeof fetch }
): Promise<(Mesh & { name: string })[]>;
/** The HRA male or female as source `hra-male` or `hra-female`. */
export declare function hraSource(
  sex: 'male' | 'female',
  options?: { fetchFn?: typeof fetch }
): Promise<AnatomySource>;

// Mouths read as MRI is read, from any glTF, and compared key point for
// key point (millimetres, y up, z forward, the model's left at -x).
export interface NamedMesh extends Mesh {
  name: string;
}
export type MeshNames = string[] | ((name: string) => boolean);
/** The JSON chunk of a .glb and where its binary chunk starts. */
export declare function glbJson(bytes: Uint8Array): {
  json: Record<string, unknown>;
  binOffset: number;
};
/** Accessors (positions, indices) the selected nodes' meshes read. */
export declare function meshAccessors(
  json: Record<string, unknown>,
  options?: { names?: MeshNames }
): number[];
/** Triangle meshes of the selected nodes, in world coordinates. */
export declare function gltfMeshes(
  json: Record<string, unknown>,
  read: (accessor: number) => ArrayLike<number>,
  options?: { names?: MeshNames; scale?: number }
): NamedMesh[];
export declare function readGlbMeshes(
  bytes: Uint8Array,
  options?: { names?: MeshNames; scale?: number }
): NamedMesh[];
/** Meshes of a remote .glb, fetching only the bytes they need. */
export declare function fetchGlbMeshes(
  url: string,
  options?: { names?: MeshNames; scale?: number; fetchFn?: typeof fetch }
): Promise<NamedMesh[]>;
export type KeyPoint =
  | 'upperIncisor'
  | 'lowerIncisor'
  | 'upperFirstMolar'
  | 'upperSecondMolar'
  | 'staphylion'
  | 'palateVault'
  | 'uvula'
  | 'tongueTip'
  | 'tongueDorsum'
  | 'glottis';
export type KeyPoints = Record<KeyPoint, number[]>;
export interface SortedTooth {
  jaw: 'upper' | 'lower';
  side: 'l' | 'r';
  type: number;
  positions: ArrayLike<number>;
}
export declare const KEY_POINTS: readonly KeyPoint[];
export declare const HRA_PARTS: Readonly<
  Record<string, (name: string) => boolean>
>;
/** Connected shells of a mesh, split vertices welded, largest first. */
export declare function meshShells(
  mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> },
  tolerance?: number
): Mesh[];
/** Teeth of an arch sorted into sides and types (0 central incisor). */
export declare function classifyTeeth(
  shells: { positions: ArrayLike<number>; indices: ArrayLike<number> }[],
  jaw: 'upper' | 'lower',
  options?: { leftSign?: number }
): SortedTooth[];
export declare function midsagittalPoints(
  mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> },
  midline?: number
): number[][];
/** Points of the parasagittal cut at x, densified to 0.25 mm. */
export declare function sagittalPoints(
  mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> },
  x: number
): number[][];
export declare function mouthKeyPoints(
  parts: Record<string, unknown>,
  midline?: number
): KeyPoints;
export declare function glottisPoint(larynx: {
  arytenoids: Mesh[];
  thyroid: Mesh;
}): number[];
/** The model's key points for a head at rest. */
export declare function modelKeyPoints(head: HeadConfig): KeyPoints;
/** Rigid fit of the model onto a reference and the distances after it. */
export declare function compareKeyPoints(
  model: Partial<KeyPoints>,
  reference: Partial<KeyPoints>,
  options?: { fit?: KeyPoint[] }
): {
  transform: {
    rotation: number[][];
    translation: number[];
    scale: number;
    rms: number;
  };
  distances: Partial<Record<KeyPoint, number>>;
  rms: number;
  fitted: KeyPoint[];
};
export declare function referenceParts(
  meshes: NamedMesh[],
  roles?: Record<string, (name: string) => boolean>
): Record<string, NamedMesh[]>;
export declare function sortedReferenceTeeth(
  parts: Record<string, NamedMesh[]>
): SortedTooth[];
/** Tooth landmarks of a reference's arches (see toothLandmarks). */
export declare function referenceTeeth(parts: Record<string, NamedMesh[]>): {
  jaw: 'upper' | 'lower';
  side: 'l' | 'r';
  type: number;
  occlusal: number[];
  width: number | null;
  thickness: number | null;
}[];
export declare function referenceKeyPoints(
  parts: Record<string, NamedMesh[]>
): KeyPoints & { midline: number };
/** Degrees of a long axis from vertical, positive with its top forward. */
export declare function sagittalLean(positions: ArrayLike<number>): number;
/** Degrees of an incisor crown's labial face from vertical. */
export declare function labialLean(
  positions: ArrayLike<number>,
  jaw: 'upper' | 'lower',
  options?: { crown?: number }
): number;
/** Mean lean of each jaw's central incisors (degrees). */
export declare function incisorLean(
  teeth: SortedTooth[],
  measure?: (tooth: SortedTooth) => number
): { upper: number; lower: number };
/** Labial-face lean of the model's central incisors at rest (degrees). */
export declare function modelIncisorLean(head: HeadConfig): {
  upper: number;
  lower: number;
};
/** Clinical distances (mm) between key points. */
export declare function keyPointMeasures(points: KeyPoints): {
  incisorToStaphylion: number;
  velumChord: number;
  overjet: number;
  overbite: number;
  dorsumHeight: number;
  palateHeight: number;
  glottisDepth: number;
};
/** Mirror meshes in x, keeping their faces outward. */
export declare function mirrorX<T extends Mesh>(meshes: T[]): T[];

// Listening: microphone position, room reverb and the box around the head
/**
 * Microphone relative to the lips: distance in cm (3 by default), azimuth
 * in degrees (0 = ahead, 90 = the speaker's left), elevation in degrees
 * (positive = up). `compensate` keeps the loudness of the 3 cm reference.
 */
export interface MicrophoneOptions {
  distance?: number;
  azimuth?: number;
  elevation?: number;
  compensate?: boolean;
}
export type RoomPreset =
  | 'anechoic'
  | 'studio'
  | 'small-room'
  | 'office'
  | 'bathroom'
  | 'classroom'
  | 'hall'
  | 'cathedral';
/**
 * Shoebox room in metres with `rt60` (s) or uniform wall `absorption`
 * (0..1) and the mouth position from a floor corner (m).
 */
export interface RoomSpec {
  width: number;
  height: number;
  depth: number;
  rt60?: number;
  absorption?: number;
  headPosition?: [number, number, number];
}
export interface ResolvedRoom {
  width: number;
  height: number;
  depth: number;
  absorption: number;
  rt60: number;
  headPosition: [number, number, number];
}
/**
 * Box of air around the head in cm (width x, height y, depth z), wall
 * absorption 0..1 (0.2 by default) and an optional centre in head
 * coordinates (the centre of the head by default). The 3D FDTD solver
 * simulates it; the waveguide approximates it with a room.
 */
export interface EnclosureOptions {
  width: number;
  height: number;
  depth: number;
  absorption?: number;
  center?: [number, number, number];
}
export interface ResolvedEnclosure {
  width: number;
  height: number;
  depth: number;
  absorption: number;
  center: [number, number, number] | null;
}
export interface EnclosureBounds {
  low: number[];
  high: number[];
  lips: number[];
  absorption: number;
}
export interface RenderOptions {
  microphone?: MicrophoneOptions;
  room?: RoomPreset | RoomSpec | null;
  enclosure?: EnclosureOptions | null;
}
export interface SynthesizeOptions {
  /** `false` leaves out the incisors. */
  teeth?: boolean;
  /** `false` leaves out the piriform fossae (both solvers). */
  piriform?: boolean;
  /** `false` leaves out the vallecula (3D FDTD). */
  vallecula?: boolean;
  microphone?: MicrophoneOptions;
  room?: RoomPreset | RoomSpec | null;
  enclosure?: EnclosureOptions | null;
}
export declare const MICROPHONE_REFERENCE: number;
export declare const MAX_RADIATION_RADIUS: number;
export declare const MAX_ENCLOSURE_CELLS: number;
/** Preset rooms; 'anechoic' is null (no room). */
export declare const ROOM_PRESETS: Readonly<
  Record<RoomPreset, Readonly<RoomSpec> | null>
>;
export declare function resolveMicrophone(
  microphone: MicrophoneOptions | null | undefined
): Required<MicrophoneOptions> | null;
export declare function microphoneDirection(microphone: {
  azimuth: number;
  elevation: number;
}): [number, number, number];
export declare function microphonePosition(
  microphone: MicrophoneOptions | null | undefined,
  lips: ArrayLike<number>
): [number, number, number];
export declare function resolveRoom(
  room: RoomPreset | RoomSpec | null | undefined
): ResolvedRoom | null;
/** Eyring reverberation time (s) of a room with uniform absorption. */
export declare function reverberationTime(room: {
  width: number;
  height: number;
  depth: number;
  absorption: number;
}): number;
/** Image sources and a feedback delay network for one microphone. */
export declare class Room {
  constructor(
    room: Exclude<RoomPreset, 'anechoic'> | RoomSpec,
    options?: { sampleRate?: number; direction?: number[]; distance?: number }
  );
  readonly room: ResolvedRoom;
  readonly sampleRate: number;
  /** Seconds of reverberation worth rendering after the voice stops. */
  readonly tail: number;
  process(input: number): number;
  reset(): void;
}
export declare function roomImpulseResponse(
  room: Exclude<RoomPreset, 'anechoic'> | RoomSpec,
  options?: {
    sampleRate?: number;
    direction?: number[];
    distance?: number;
    seconds?: number;
  }
): Float32Array;
export declare function resolveEnclosure(
  enclosure: EnclosureOptions | null | undefined | false
): ResolvedEnclosure | null;
export declare function enclosureBounds(
  head: HeadConfig,
  enclosure: EnclosureOptions | null | undefined
): EnclosureBounds | null;
/** buildVoxelModel options for render options (to build or cache a model). */
export declare function voxelModelOptions(options?: {
  dx?: number;
  microphone?: MicrophoneOptions;
  enclosure?: EnclosureOptions | null;
  piriform?: boolean;
  vallecula?: boolean;
}): {
  dx: number;
  radiationRadius?: number;
  enclosure?: ResolvedEnclosure;
  piriform?: false;
  vallecula?: false;
};
/** Listening chain after a solver, or null for the default output. */
export declare function createListener(options: {
  microphone?: MicrophoneOptions;
  room?: RoomPreset | RoomSpec | null;
  enclosure?: EnclosureBounds | null;
  solver: Solver;
  sampleRate: number;
}): { process(value: number): number; tail: number } | null;

// Voice presets and matching (issue 5)
export type HeadPresetName =
  | 'any'
  | 'male'
  | 'female'
  | 'child'
  | 'child5'
  | 'teenMale'
  | 'teenFemale'
  | 'elderlyMale'
  | 'elderlyFemale'
  | 'bass'
  | 'baritone'
  | 'tenor'
  | 'alto'
  | 'mezzo'
  | 'soprano';
export interface HeadPreset {
  label: string;
  /** The preset a derived speaker type starts from (issue 41). */
  base?: 'male' | 'female' | 'child';
  /** `[small, large, spread]` per parameter (pitch spread in semitones). */
  ranges: Readonly<Record<string, readonly [number, number, number]>>;
}
export declare const HEAD_PRESETS: Readonly<
  Record<Exclude<HeadPresetName, 'any'>, HeadPreset>
>;
export declare const HEAD_PRESET_NAMES: readonly HeadPresetName[];
/** The head of a preset at a relative size (0 smallest, 1 largest). */
export declare function presetHeadConfig(
  name: Exclude<HeadPresetName, 'any'>,
  size?: number
): HeadConfig;

// Voice files (issue 41)
/** A voice file: a preset plus the head values that differ from it. */
export interface VoiceFile {
  format: 'voice-simulator/voice';
  version: number;
  name?: string;
  description?: string;
  preset?: Exclude<HeadPresetName, 'any'>;
  /** Accent the voice speaks with; an accent option wins over it. */
  accent?: AccentCode | { code: AccentCode; strength?: number };
  anatomy?: HeadConfig;
  folds?: HeadConfig;
  breathing?: HeadConfig;
  articulation?: HeadConfig;
  expression?: HeadConfig;
  microphone?: HeadConfig;
}
export interface Voice {
  name: string | null;
  description: string | null;
  preset: Exclude<HeadPresetName, 'any'> | null;
  accent: AccentCode | { code: AccentCode; strength: number } | null;
  /** Complete: the values the file leaves out come from the preset or the defaults. */
  head: HeadConfig;
  /** The problems clamped or skipped by a lenient load. */
  warnings: string[];
}
export declare const VOICE_FORMAT: 'voice-simulator/voice';
export declare const VOICE_VERSION: number;
/** Old parameter names and the names that replaced them. */
export declare const RENAMED_KEYS: Readonly<Record<string, string>>;
/**
 * Read a voice file (object or JSON text), a flat head object or a
 * `key=value&...` fragment. Strict (default) throws one Error with one
 * line per problem (also in `error.problems`).
 */
export declare function loadVoice(
  input: VoiceFile | HeadConfig | string,
  options?: { strict?: boolean }
): Voice;
/** A voice file object: only the values that differ from the preset, or all with `full`. */
export declare function saveVoice(
  voice:
    | (Partial<Pick<Voice, 'name' | 'description' | 'preset' | 'accent'>> & {
        head: HeadConfig;
      })
    | HeadConfig,
  options?: { full?: boolean }
): VoiceFile;
/** JSON Schema (draft 2020-12) of a voice file (schemas/voice.schema.json). */
export declare function voiceSchema(): Record<string, unknown>;
export interface VoiceFeatures {
  duration: number;
  /** Seconds above the silence threshold. */
  activeDuration: number;
  voicedDuration: number;
  /** Median f0 (Hz). */
  f0: number;
  f0Low: number;
  f0High: number;
  /** 5-95 % f0 range in semitones. */
  f0Range: number;
  /**
   * Median F1-F4 (Hz). Always four entries; formants beyond `formantCount`
   * (3 at 8000 Hz) were not measured and are 0.
   */
  formants: number[];
  formantSpacing: number;
  /** Vocal tract length (cm) from the formant spacing. */
  vocalTractLength: number;
  /** First minus second harmonic level (dB). */
  h1h2: number;
  /**
   * Harmonics-to-noise ratio (dB, at most 30) above 400 Hz, from the
   * aperiodicity of pitch-straightened frames at the best fractional lag;
   * the upper quartile over the voiced frames.
   */
  hnr: number;
  syllableRate: number;
}
export declare function analyzeVoice(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: {
    maxDuration?: number;
    analysisRate?: number;
    order?: number;
    /**
     * Formants measured and fitted for the formant spacing and the vocal
     * tract length. Default min(4, floor(0.45 rate / 1000)) where rate is
     * the rate after resampling: 3 at 8000 Hz, 4 from 11025 Hz.
     */
    formantCount?: number;
  }
): VoiceFeatures;
export interface VoiceMatchOptions {
  /** Restrict the starting person to one preset. */
  preset?: HeadPresetName;
  /** Renders (default 4, at most 12). */
  iterations?: number;
  /** What the recording says; the renders then say the same words. */
  transcript?: string;
  lang?: string;
  /** Seconds of the recording analysed (default 30). */
  maxDuration?: number;
}
export interface VoiceMatch {
  head: HeadConfig;
  preset: Exclude<HeadPresetName, 'any'>;
  features: VoiceFeatures;
  rendered: VoiceFeatures;
  distance: number;
}
export interface VoiceMatchStep {
  step: number;
  total: number;
  head: HeadConfig;
  distance: number;
}
/** Sentence rendered when the recording has no transcript. */
export declare const MATCH_TEXT: string;
export declare function featureDistance(
  target: VoiceFeatures,
  candidate: VoiceFeatures,
  options?: { transcript?: string }
): number;
export declare function matchVoice(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: VoiceMatchOptions
): VoiceMatch;
export declare function matchVoiceSteps(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: VoiceMatchOptions
): Generator<VoiceMatchStep, VoiceMatch, void>;
// Objective speech metrics and recording comparison
/** Absolute floor under powers before taking logarithms (1e-10). */
export declare const EPSILON: number;
/**
 * Dynamic range (dB, 60) kept below the strongest bin power or mel filter
 * energy of a signal before a logarithm; weaker values are raised to it.
 */
export declare const DYNAMIC_RANGE_DB: number;
/** max(EPSILON, 10^(-range / 10) * the largest value of all frames). */
export declare function powerFloor(
  frames: ArrayLike<number>[],
  range?: number
): number;
export declare const METRIC_DEFAULTS: Readonly<{
  sampleRate: 16000;
  /** Hann window (s). */
  window: number;
  /** Frame step (s). */
  hop: number;
  fftSize: 512;
  melFilters: 26;
  /** Cepstral coefficients c[1] .. c[13] besides c[0]. */
  coefficients: 13;
  epsilon: number;
  /** DYNAMIC_RANGE_DB. */
  dynamicRange: number;
}>;
export interface FrameOptions {
  /** Window length in seconds (default 0.025). */
  window?: number;
  /** Frame step in seconds (default 0.01). */
  hop?: number;
  /** FFT size (default the next power of two of the window). */
  size?: number;
}
export interface CepstrumOptions extends FrameOptions {
  /** Mel filters (default 26). */
  filters?: number;
  /** Coefficients besides c[0] (default 13). */
  coefficients?: number;
  /** Dynamic range (dB) below the strongest value (default 60). */
  range?: number;
}
/** In-place radix-2 FFT; the length must be a power of two. */
export declare function fft(re: Float64Array, im: Float64Array): void;
/** Power spectra |X[k]|^2, k = 0 .. size / 2, of Hann-windowed frames. */
export declare function powerFrames(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: FrameOptions
): Float64Array[];
/** Triangular mel filters, one weight per FFT bin each. */
export declare function melFilterbank(
  count: number,
  size: number,
  sampleRate: number
): Float64Array[];
/** Mel cepstra c[0] .. c[13] per frame (natural log, DCT-II with sqrt(2/M)). */
export declare function mfcc(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: CepstrumOptions
): Float64Array[];
export interface DtwResult {
  cost: number;
  /** cost / path.length. */
  normalizedCost: number;
  /** Pairs [reference frame, test frame] from [0, 0] to [n - 1, m - 1]. */
  path: [number, number][];
}
/** Dynamic time warping; throws a RangeError above 25e6 cells. */
export declare function dtw<T = ArrayLike<number> | number>(
  a: ArrayLike<T>,
  b: ArrayLike<T>,
  options?: {
    /** Local distance (default Euclidean). */
    distance?: (x: T, y: T) => number;
    /** Sakoe-Chiba band 0 to 1 on relative positions (default 1). */
    band?: number;
    /**
     * Weight of the local distance on a diagonal step (default 1, which
     * keeps the path near the diagonal; 2 is the symmetric form of Sakoe &
     * Chiba 1978, which follows the signals).
     */
    diagonalWeight?: number;
  }
): DtwResult;
export interface DistortionOptions extends CepstrumOptions {
  /** Frame pairs (default frame t with frame t). */
  path?: [number, number][];
  /** Scale both signals to an RMS of 0.1 first (default true). */
  normalize?: boolean;
}
/**
 * Log-spectral distance (dB), averaged over the frame pairs whose reference
 * frame is not silent (40 dB below the loudest reference frame).
 */
export declare function logSpectralDistance(
  reference: ArrayLike<number>,
  test: ArrayLike<number>,
  sampleRate: number,
  options?: DistortionOptions
): number;
/**
 * Mel-cepstral distortion (dB) over c[1] .. c[13], averaged over the frame
 * pairs whose reference frame is not silent.
 */
export declare function melCepstralDistortion(
  reference: ArrayLike<number>,
  test: ArrayLike<number>,
  sampleRate: number,
  options?: DistortionOptions
): number;
/** Pitch (Hz, 0 = unvoiced) every hop seconds by YIN. */
export declare function pitchTrack(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: { hop?: number; window?: number }
): Float64Array;
export interface F0Errors {
  /** Root mean square error over frames voiced in both (cents). */
  rmseCents: number | null;
  /** Mean error (cents, test above reference is positive). */
  meanCents: number | null;
  /** Gross pitch error: share of frames voiced in both off by more than 20 %. */
  gpe: number | null;
  /** Voicing decision error: share of frames voiced in only one track. */
  vde: number | null;
  /** f0 frame error: (gross errors + voicing errors) / frames. */
  ffe: number | null;
  /** Pearson correlation of log f0 over frames voiced in both. */
  correlation: number | null;
  voicedFrames: number;
  frames: number;
}
export declare function f0Errors(
  reference: ArrayLike<number>,
  test: ArrayLike<number>
): F0Errors;
/** F1-F3 (Hz) per frame, null for unvoiced frames. */
export declare function formantTrack(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: { hop?: number; pitch?: ArrayLike<number> }
): (number[] | null)[];
export interface FormantError {
  /** Mean absolute difference (Hz). */
  hz: number | null;
  /** Mean absolute difference in percent of the reference. */
  percent: number | null;
}
export interface FormantErrors {
  /** Frames with formants in both tracks. */
  frames: number;
  f1: FormantError;
  f2: FormantError;
  f3: FormantError;
}
export declare function formantErrors(
  reference: readonly (ArrayLike<number> | null)[],
  test: readonly (ArrayLike<number> | null)[]
): FormantErrors;
export interface EditDistance {
  distance: number;
  substitutions: number;
  deletions: number;
  insertions: number;
}
export type ErrorRateUnit = 'word' | 'char' | 'phone';
export interface ErrorRate extends EditDistance {
  referenceLength: number;
  /** distance / max(1, referenceLength). */
  rate: number;
}
/** Levenshtein distance between two token lists. */
export declare function editDistance(
  reference: ArrayLike<unknown>,
  hypothesis: ArrayLike<unknown>
): EditDistance;
export declare function tokenize(text: string, unit?: ErrorRateUnit): string[];
/** Word (WER), character (CER) or phoneme (PER) error rate. */
export declare function errorRate(
  reference: string | ArrayLike<unknown>,
  hypothesis: string | ArrayLike<unknown>,
  unit?: ErrorRateUnit
): ErrorRate;
export interface AudioInput {
  samples: ArrayLike<number>;
  sampleRate: number;
}
export interface RecordingComparison {
  /** Rate both recordings were compared at: min(16000, both rates). */
  sampleRate: number;
  /** Seconds after the silence at both ends is cut; ratio = test / reference. */
  duration: { reference: number; test: number; ratio: number };
  /** Log-spectral distance along the DTW path (dB). */
  lsd: number;
  /** Mel-cepstral distortion along the DTW path (dB). */
  mcd: number;
  f0: F0Errors;
  /** Null when `formants: false`. */
  formants: FormantErrors | null;
  timing: { rmsSeconds: number; maxSeconds: number };
  dtw: { normalizedCost: number };
  frames: { reference: number; test: number; path: number };
}
/** Align two recordings by DTW on mel cepstra and measure their distances. */
export declare function compareRecordings(
  reference: AudioInput,
  test: AudioInput,
  options?: {
    band?: number;
    window?: number;
    hop?: number;
    /** false skips the formant tracks (default true). */
    formants?: boolean;
    /** Dynamic range (dB) of the spectral distances (default 60). */
    range?: number;
  }
): RecordingComparison;
// Linguistics: text normalisation, accents, prosody, syllables, timeline
export declare const VERBALIZERS: Readonly<Record<LanguageCode, object>>;
export declare function normalizeText(
  text: string,
  options: { lang: string; wordLanguage: (word: string) => string }
): object[];
export interface AccentEntry {
  code: AccentCode;
  name: string;
  native: string;
  kind: 'standard' | 'regional' | 'foreign';
}
/** The accents of every language, the default first. */
export declare const ACCENTS: Readonly<
  Record<LanguageCode, readonly AccentEntry[]>
>;
export declare const ACCENT_FORMAT: 'voice-simulator/accent';
export declare const ACCENT_VERSION: 1;
export declare const MAX_ACCENT_RULES: 500;
/** The first-language profiles of the foreign accents. */
export declare const ACCENT_PROFILES: Readonly<Record<LanguageCode, object>>;
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
/** The accent code for a language, or null when it has no accents. */
export declare function resolveAccent(
  lang: string,
  accent?: string | null
): AccentCode | null;
/** Adapt a General American transcription to another accent. */
export declare function adaptEnglishWord(
  ipa: string,
  spelling: string,
  accent: AccentCode | string
): string;
export declare function isNonRhotic(accent: AccentCode | string): boolean;
/** Kind of an English function word in `WEAK_FORMS`. */
export type FunctionWordKind =
  | 'article'
  | 'conjunction'
  | 'preposition'
  | 'auxiliary'
  | 'pronoun';
/** Weak (General American) form of every English function word. */
export declare const WEAK_FORMS: Readonly<
  Record<string, Readonly<{ kind: FunctionWordKind; weak: string }>>
>;
export declare const BOUNDARIES: Readonly<Record<string, object>>;
export declare const CONTOURS: Readonly<Record<string, object>>;
export declare function boundaryOf(pause: object | null | undefined): string;
export declare function pauseDuration(pause: object): number;
export declare function intonationPhrases(segments: object[]): object[];
export declare function sonority(token: object): number;
export declare function syllabifyTokens(
  tokens: object[],
  options?: { language?: string }
): object[][];
export declare function syllableIpa(tokens: object[]): string;
/** Syllables (as IPA) of each word of an IPA string. */
export declare function syllabifyIpa(
  ipa: string,
  options?: { language?: string }
): string[][];
export declare function syllableSpans(
  word: string,
  syllables: { onset: number; coda: number; size: number }[],
  options?: { exactOnly?: boolean }
): { start: number; end: number }[] | null;
export declare function hindiAksharas(word: string): object[];
export declare function utteranceTimeline(
  plan: Plan,
  options?: { words?: Word[]; ipa?: string; language?: string }
): Timeline;
/** Indices of the word and syllable spoken at `time`, null in a pause. */
export declare function timelineAt(
  timeline: Timeline | null | undefined,
  time: number
): { word: number; syllable: number } | null;
// Face animation: ARKit blendshapes, VRM expressions and Oculus visemes
export type VisemeFormat = 'arkit' | 'vrm' | 'oculus';
export declare const ARKIT_BLENDSHAPES: readonly string[];
export declare const VRM_VISEMES: readonly ['aa', 'ih', 'ou', 'ee', 'oh'];
export declare const OVR_VISEMES: readonly string[];
export declare const VISEME_FORMATS: Readonly<
  Record<VisemeFormat, readonly string[]>
>;
/** Largest inter-incisor opening (cm), jawOpen 1. */
export declare const MAX_OPENING: number;
export interface VowelShapes {
  aa: number;
  ee: number;
  ih: number;
  oh: number;
  ou: number;
}
/** Physical face measures of an articulator state. */
export interface FaceRig {
  /** Inter-incisor gap (cm). */
  gap: number;
  /** Jaw rotation (radians) about the jaw pivot. */
  jawAngle: number;
  /** Jaw angle over the angle at the largest opening, 0..1. */
  jawOpen: number;
  /** Lip opening width and height (cm). */
  lipWidth: number;
  lipHeight: number;
  lipsSealed: number;
  /** Lip opening beyond the incisor gap (cm). */
  lipParting: number;
  /** Forward push of the lips (cm): the lipProtrusion channel. */
  protrusion: number;
  /** Larynx above its place in the vowel (cm, negative lowered). */
  larynxHeight: number;
  rounding: number;
  spread: number;
  bilabial: number;
  labiodental: number;
  roundedLabial: number;
  tongueAmount: number;
  tongueLocation: number;
  tongue: {
    dental: number;
    alveolar: number;
    postalveolar: number;
    palatal: number;
    velar: number;
  };
  sibilance: number;
  rhotic: number;
  lateral: number;
  nasal: number;
  vowel: VowelShapes;
  silence: number;
}
export interface VisemeTrack {
  format: VisemeFormat;
  fps: number;
  duration: number;
  names: readonly string[];
  frames: { time: number; weights: Record<string, number> }[];
}
export declare function vowelShapes(state: {
  height?: number;
  backness?: number;
  rounding?: number;
}): VowelShapes;
export declare function faceRig(
  state: Record<string, number>,
  head?: Partial<HeadConfig>,
  options?: { shape?: object; maxOpening?: number }
): FaceRig;
export declare function arkitBlendshapes(rig: FaceRig): Record<string, number>;
export declare function vrmExpressions(rig: FaceRig): Record<string, number>;
export declare function ovrVisemes(rig: FaceRig): Record<string, number>;
export declare function rigWeights(
  rig: FaceRig,
  format: VisemeFormat
): Record<string, number>;
export declare function visemeTrack(
  plan: Plan,
  head?: Partial<HeadConfig>,
  options?: {
    fps?: number;
    format?: VisemeFormat;
    maxOpening?: number;
    digits?: number;
  }
): VisemeTrack;
export declare function rigFrames<T>(
  plan: Plan,
  head: Partial<HeadConfig> | undefined,
  options: { fps?: number; maxOpening?: number },
  weigh: (rig: FaceRig) => T
): { fps: number; frames: { time: number; weights: T }[] };
export interface RigBinding {
  format: VisemeFormat | null;
  targets: { name: string; index: number; channel: string }[];
}
export declare function bindRig(
  names: readonly string[],
  options?: { format?: VisemeFormat }
): RigBinding;
export declare function rigFrame(
  binding: RigBinding,
  rig: FaceRig
): Record<string, number>;
export declare function characterTrack(
  plan: Plan,
  head: Partial<HeadConfig> | undefined,
  names: readonly string[],
  options?: { fps?: number; maxOpening?: number; format?: VisemeFormat }
): {
  format: VisemeFormat | null;
  fps: number;
  duration: number;
  names: string[];
  frames: { time: number; weights: number[] }[];
};
export interface VrmBind {
  node?: number;
  mesh?: number;
  index: number;
  weight: number;
}
export declare function vrmVowelBinds(
  json: object
): Record<'aa' | 'ih' | 'ou' | 'ee' | 'oh', VrmBind[]> | null;

// The z-up atlases on the Visible Human Japanese male: Z-Anatomy
// (CC BY-SA 4.0) and BodyParts3D (CC BY 4.0), fetched just in time.
export interface Atlas {
  readonly name: string;
  readonly citation: string;
  readonly license: string;
}
type TriangleMesh = {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
};
type AtlasMesh = TriangleMesh & { name: string };
type AtlasRoles = Readonly<Record<string, (name: string) => boolean>>;
/** Height (mm) above the palatal vault where the palate bones are cut. */
export declare const PALATE_BONE_CUT: number;
/** Distance (mm) beside the midline where the bony palate is read. */
export declare const PALATE_SUTURE: number;
export declare const Z_ANATOMY_ATLAS: Atlas;
export declare const BODYPARTS3D_ATLAS: Atlas;
export declare const Z_ANATOMY_PARTS: AtlasRoles;
/** BodyParts3D 4.0 element file ids per role. */
export declare const BODYPARTS3D_FILES: Readonly<
  Record<string, readonly string[]>
>;
export declare const BODYPARTS3D_PARTS: AtlasRoles;
/** Meshes of a z-up atlas in the head frame, their faces kept outward. */
export declare function atlasToHeadFrame<T extends TriangleMesh>(
  meshes: T[]
): (T & { positions: Float64Array; indices: Uint32Array })[];
/** Triangles wholly at or below a height (y, mm). */
export declare function cutAbove<T extends TriangleMesh>(
  mesh: T,
  height: number
): T & { positions: Float64Array; indices: Uint32Array };
/** Staphylion and palatal vault of a bony palate (mm, head frame). */
export declare function bonyPalateKeyPoints(
  palate: TriangleMesh,
  midline: number,
  molarDepth: number
): { staphylion: number[]; palateVault: number[] };
export declare function atlasSource(
  atlas: Atlas,
  meshes: AtlasMesh[],
  roles: AtlasRoles
): AnatomySource;
export declare function zAnatomySource(meshes: AtlasMesh[]): AnatomySource;
export declare function bodyParts3dSource(meshes: AtlasMesh[]): AnatomySource;
/** A Wavefront OBJ as one triangle mesh. */
export declare function parseObj(text: string): {
  positions: Float64Array;
  indices: Uint32Array;
};
