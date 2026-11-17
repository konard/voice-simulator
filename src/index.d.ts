/**
 * Type definitions for voice-simulator: physical 3D voice simulation.
 */

import type {
  AccentDefinition,
  AccentOption,
  AccentSettings,
} from './accent/index.js';

export type LanguageCode = 'en' | 'ru' | 'hi' | 'zh';
export {
  ipaToText,
  type IpaToTextOptions,
  type IpaToTextResult,
  type RecognitionSound,
  type RecognitionWord,
  type RecognitionSyllable,
} from './recognition/ipa-to-text.js';
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

export interface Transcription {
  lang: string;
  /** Accent code of the language (en-US, en-x-ru, zh-TW, ...). */
  accent?: AccentCode | string | null;
  /** Strength of the accent, 0 to 1. */
  accentLevel?: number | null;
  ipa: string;
  words: Word[];
  /** Mode spans of the speech markup, in IPA word indexes. */
  modes?: ModeSpan[];
  /** Warnings of the markup parser (unknown or unclosed tags). */
  warnings?: MarkupWarning[];
}

// Speech markup (docs/markup.md)
export interface Phonation {
  breathy: number;
  creaky: number;
  /** Positive pressed, negative lax. */
  tension: number;
  falsetto: number;
  harsh: number;
  whisper: number;
}

export interface Emotion {
  /** A name of EMOTION_PRESETS, e.g. 'angry'; 'neutral' by default. */
  name: string;
  /** 0 … 1; 1 when a named emotion is written without one. */
  intensity: number;
  arousal: number;
  valence: number;
  dominance: number;
}

/** A speech mode: how a stretch of speech is spoken. */
export interface Mode {
  /** Vocal effort 0 … 1 (0.5 normal) at the start and the end of a span. */
  effort: number;
  effortEnd: number;
  /** Level change in dB. */
  gain: number;
  /** Speech rate factor (1.3 is 30% faster). */
  rate: number;
  /** Pitch shift in semitones. */
  pitch: number;
  /** Factor of the pitch range. */
  range: number;
  /** -0.5 reduced, 0 none, 0.5 moderate, 1 strong. */
  emphasis: number;
  phonation: Phonation;
  emotion: Emotion;
  tune: string | null;
  lang: string | null;
}

/**
 * A mode over IPA words `from` … `to` (exclusive), or over the sound
 * `sound` (its index among the `⸨…⸩` of the IPA).
 */
export type ModeSpan =
  | { from: number; to: number; mode: Mode }
  | { sound: number; mode: Mode };

/** A mode of a plan from `start` to `end` seconds. */
export type PlanMode = Mode & { start: number; end: number };

export interface PlanSound {
  name: string;
  start: number;
  end: number;
}

export interface MarkupWarning {
  position: number;
  message: string;
}

export interface ParsedMarkup {
  markup: 'ssml' | 'inline' | null;
  /** The text without the markup. */
  text: string;
  /** Input offset of every character of `text`. */
  offsets: number[];
  /** Mode spans in `text` offsets (`end` exclusive). */
  spans: { start: number; end: number; mode: Mode }[];
  breaks: { at: number; seconds: number }[];
  sounds: { at: number; name: string; duration: number | null }[];
  /** Words given in IPA (`phoneme`, `[ipa …]`). */
  overrides: { start: number; end: number; ipa: string }[];
  /** Ranges of `sub` and `say-as` in the input. */
  sources: {
    start: number;
    end: number;
    sourceStart: number;
    sourceEnd: number;
    original: string;
  }[];
  warnings: MarkupWarning[];
  lang: string | null;
}

export declare class MarkupError extends Error {
  /** Offset in the input. */
  position: number;
}
export declare const MARKUP_LIMITS: Readonly<{
  maxLength: number;
  maxDepth: number;
  maxElements: number;
  maxPauseSeconds: number;
}>;
export declare const MARKUP_NAMESPACE: string;
export declare const MODE_DEFAULTS: Readonly<Mode>;
export declare const SOUND_NAMES: readonly string[];
/** Tune labels of the markup (issue 51): `{IK4 … IK4}`, `[tune IK4]`, `<vs:tune name="IK4">`. */
export declare const TUNE_LABELS: readonly string[];
export declare const SOUND_DURATION: number;

// Paralinguistic sounds (issue 56)
/** A part of a sound recipe. */
export interface SoundPart {
  /** IPA phone that gives the tract shape. */
  phone: string;
  seconds: number;
  /** Glottal noise instead of voice. */
  noise?: boolean;
  /** Level in dB re a vowel at the start and the end of the part. */
  level?: [number, number];
  /** Pitch in semitones re the voice (or the syllable before). */
  pitch?: [number, number];
  phonation?: Partial<Phonation>;
}
export interface SoundRecipe {
  /** Default length in seconds. */
  seconds: number;
  description: string;
  /** Calls of a laugh or a cough: `duration` sets their number. */
  calls?: { seconds: number; count: number; min: number; max: number };
  /** `'before'`: the pitch is re the syllable before. */
  reference?: 'voice' | 'before';
  parts(context: { calls?: number; language?: string | null }): SoundPart[];
}
/** The recipes of the sounds (docs/markup.md). */
export declare const SOUNDS: Readonly<Record<string, SoundRecipe>>;
/** IPA of `filler` and `um` per language. */
export declare const FILLERS: Readonly<
  Record<'filler' | 'um', Readonly<Record<'en' | 'ru' | 'hi' | 'zh', string>>>
>;
/** Constants of the `breaths` option. */
export declare const BREATHS: Readonly<{
  minPause: number;
  base: number;
  perSyllable: number;
  max: number;
  gap: number;
  before: number;
}>;
export declare function isSound(name: string): boolean;
/** Calls of a laugh or cough of `seconds`: round(seconds / 0.2…), 1 to 12. */
export declare function soundCalls(
  name: string,
  seconds?: number | null
): number | null;
/** Seconds of a sound token at rate 1. */
export declare function soundSeconds(token: {
  name: string;
  duration?: number;
}): number;
/** Plan segments of a sound token. */
export declare function soundSegments(
  token: { name: string; duration?: number; mode?: object },
  context?: { seconds?: number; language?: string | null }
): object[];
export declare const EMOTIONS: Readonly<
  Record<string, readonly [number, number, number]>
>;
/**
 * Parse speech markup: SSML when the text starts with `<speak` (unless
 * `markup` is false), inline tags with `markup: true`, otherwise plain.
 * Malformed SSML throws `MarkupError`; inline parsing never throws.
 */
export declare function parseMarkup(
  text: string,
  options?: {
    markup?: boolean;
    head?: { pitch?: number };
    limits?: Partial<typeof MARKUP_LIMITS>;
  }
): ParsedMarkup;
export declare function isSsml(text: string): boolean;
export declare function createMode(fields?: Partial<Mode>): Mode;
export declare function composeMode(outer: Mode, change?: object): Mode;
/** The mode of `plan.modes` at `time` seconds. */
export declare function modeAt(
  plan: { modes: PlanMode[] },
  time: number
): PlanMode;

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
  /** The sound a written filler or laughter is read as (`um`, `laugh`). */
  sound?: string;
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
  /** Words; a written filler or laughter (`um`, `hahaha`) is a word with `sound`. */
  words: TimelineWord[];
  /** Sounds of the utterance (markup, written and breaths); not words. */
  sounds: PlanSound[];
}

export interface Plan {
  tokens: object[];
  segments: object[];
  head: HeadConfig;
  frameRate: number;
  frameCount: number;
  duration: number;
  /**
   * Control channels at `frameRate`, among them `whisper` (0 … 1, issue
   * 53): 1 in a whisper and in voiceless or whispered vowels and sonorants.
   */
  channels: Record<string, Float32Array>;
  /** Mode spans in seconds: sorted, not overlapping, covering the plan. */
  modes: PlanMode[];
  /**
   * Sounds (`⸨laugh⸩`, `[laugh]`, `hahaha`, `um` and the breaths of the
   * `breaths` option), in seconds.
   */
  sounds: PlanSound[];
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
  /**
   * Start at sample `Math.round(startTime * sampleRate)` of the utterance
   * (s, default 0) with a silent solver and listener (issue 29); see
   * `restoreSources`.
   */
  startTime?: number;
  /**
   * The engine of renderPlan and renderPlanAsync (default `'auto'`: Rust
   * when it loads, else JavaScript); see createEngine.
   */
  engine?: EngineName | Engine;
  /** Threads of the engine (default 1); see createEngine. */
  threads?: number | 'auto';
  /** WebAssembly SIMD build of the Rust engine (default `'auto'`). */
  simd?: 'auto' | boolean;
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
  /** Pronunciations for this call only (see `textToIpa`). */
  lexicon?: CallLexicon;
  /** Treat the text as IPA. */
  ipa?: boolean;
  /**
   * Speech markup (docs/markup.md): a text that starts with `<speak` is
   * SSML unless `markup` is false; `true` also reads inline tags.
   */
  markup?: boolean;
  /**
   * Breathe in between sentences (default false): an inhale in every pause
   * of 0.3 s or more after `. ? ! ‖` (not at the start),
   * `min(0.7, 0.3 + 0.03 n)` seconds before n syllables, ending 0.05 s
   * before the next word.
   */
  breaths?: boolean;
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
  /**
   * Headroom in dB for loud spans (default: the largest `E + gain` of the
   * plan, at least 0): the output is lowered by it for the whole utterance.
   * A fixed number keeps several utterances comparable.
   */
  headroom?: number;
  /**
   * Loudness target in LUFS (BS.1770; for example -23 as in EBU R 128): the
   * finished samples are scaled to it, but never above a peak of 0.98. Not
   * available for `synthesizeStream`.
   */
  loudnessTarget?: number;
  /**
   * The engine that renders (default `'auto'`: Rust when it loads, else
   * JavaScript); see createEngine. Rust and JavaScript differ by up to 1e-4
   * per sample, so `'js'` gives byte-stable output.
   */
  engine?: EngineName | Engine;
  /** Threads of the engine (default 1); see createEngine. */
  threads?: number | 'auto';
  /** WebAssembly SIMD build of the Rust engine (default `'auto'`). */
  simd?: 'auto' | boolean;
}

export interface SynthesisResult extends Transcription {
  head: HeadConfig;
  plan: Plan;
  timeline: Timeline;
  sampleRate: number;
  samples: Float32Array;
  duration: number;
  /** Level change of the headroom, `-headroom` dB (0 without loud spans). */
  levelOffsetDb: number;
  /** Integrated loudness in LUFS when `loudnessTarget` was given. */
  loudness?: number;
}

// Vocal effort (docs/markup.md): `E = (effort - 0.5) * 40` dB.
export interface EffortRule {
  unit: 'dB' | 'factor' | 'st' | 'Hz';
  value: (E: number, head?: { pitch?: number }) => number;
  source: string;
}
export type EffortQuantity =
  | 'level'
  | 'lungPressure'
  | 'pitch'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'tilt'
  | 'vowelDuration'
  | 'consonantDuration'
  | 'noise';
export declare const EFFORT_RULES: Readonly<
  Record<EffortQuantity, Readonly<EffortRule>>
>;
/** Limits of the pitch rule in semitones: `{min: -4, max: 12}`. */
export declare const EFFORT_PITCH_LIMITS: Readonly<{
  min: number;
  max: number;
}>;
/** Effort ramps faster than this (dB/s) get a warning. */
export declare const EFFORT_RAMP_LIMIT: number;
/**
 * Pitch rise (semitones) the fold source gives on its own at `E` dB,
 * `[E, st]` points measured on `ˈa` (issue 52, step 8).
 */
export declare const FOLD_PITCH_RISE: ReadonlyArray<readonly [number, number]>;
/** Factor on the pitch the fold tension is set for at `E` dB. */
export declare function foldPitchFactor(E: number): number;
/** The value of every rule at `E` dB (pitch in semitones re `head.pitch`). */
export declare function effortChanges(
  E: number,
  head?: { pitch?: number }
): Record<EffortQuantity, number>;
/** `(effort - 0.5) * 40`. */
export declare function effortToDecibels(effort: number): number;
/** `0.5 + decibels / 40`. */
export declare function decibelsToEffort(decibels: number): number;
/** dB SPL at 1 m: `60 + E` (effort 0.5 is conversational speech). */
export declare function effortToSpl(effort: number): number;
export declare function splToEffort(spl: number): number;
/** Mode spans whose effort changes faster than `limit` dB/s. */
export declare function fastEffortRamps(
  modes: { start: number; end: number; effort: number; effortEnd: number }[],
  limit?: number
): { start: number; end: number; rate: number }[];
/** The largest `E + gain` (dB) of the mode spans, at least 0. */
export declare function maxModeLevel(
  modes: { effort: number; effortEnd: number; gain?: number }[]
): number;

// Level and loudness measures.
/** RMS in dB re full scale of `samples[from..to)`; -200 for silence. */
export declare function levelDb(
  samples: ArrayLike<number>,
  from?: number,
  to?: number
): number;
/** Level of 1-5 kHz minus level of 50 Hz-1 kHz (dB). */
export declare function alphaRatio(
  samples: ArrayLike<number>,
  sampleRate: number,
  from?: number,
  to?: number
): number;
/** Frames below this share of the loud frames' level have no signal. */
export declare const SIGNAL_SHARE: number;
/** Share of the loud frames' level that voicedShare judges (0.3). */
export declare const VOICED_SHARE_SIGNAL: number;
/** A frame with a YIN aperiodicity below this (0.2) is voiced. */
export declare const VOICED_SHARE_APERIODICITY: number;
/**
 * YIN aperiodicity of the 30 ms frames (hop 10 ms) with signal: those
 * above `share` (default SIGNAL_SHARE) of the 95th percentile of the frame
 * levels. Near 0 periodic, near 1 noise.
 */
export declare function frameAperiodicities(
  samples: ArrayLike<number>,
  sampleRate: number,
  share?: number
): number[];
/** Share 0 … 1 of the loud frames that are voiced; 0 without signal. */
export declare function voicedShare(
  samples: ArrayLike<number>,
  sampleRate: number
): number;
/** Level above 2.5 kHz minus level of 50 Hz-1 kHz (dB). */
export declare function energyRatio(
  samples: ArrayLike<number>,
  sampleRate: number,
  from?: number,
  to?: number
): number;
/** Power-weighted mean frequency (Hz) above 50 Hz; 0 for silence. */
export declare function centreOfGravity(
  samples: ArrayLike<number>,
  sampleRate: number,
  from?: number,
  to?: number
): number;
/**
 * Cepstral peak prominence (dB) of the voiced 40 ms Hann frames: the
 * cepstral peak between 1/300 and 1/60 s above the regression line, the
 * median over the frames (issue 54).
 */
export declare function cpp(
  samples: ArrayLike<number>,
  sampleRate: number
): number;
/** Settings of cpp() and the glottal pulse measures. */
export declare const PHONATION_ANALYSIS: Readonly<Record<string, number>>;
/** Runs of glottal periods (s) of the voiced stretches; `start` in s. */
export declare function glottalPeriods(
  samples: ArrayLike<number>,
  sampleRate: number
): { start: number; periods: number[] }[];
/**
 * Jitter (%): mean absolute difference of neighbouring periods over the
 * mean period, of the periods that start within `span` (s).
 */
export declare function jitterPercent(
  samples: ArrayLike<number>,
  sampleRate: number,
  span?: { start?: number; end?: number }
): number;
/** Median f0 (Hz) of the glottal periods within `span` (s); 0 for none. */
export declare function pulseF0(
  samples: ArrayLike<number>,
  sampleRate: number,
  span?: { start?: number; end?: number }
): number;
/** Median pitch-synchronous H1-H2 (dB) over windows of 4 periods. */
export declare function pulseH1H2(
  samples: ArrayLike<number>,
  sampleRate: number
): number;
/** The two K-weighting biquads `[b0, b1, b2, a1, a2]` of BS.1770. */
export declare function kWeighting(sampleRate: number): number[][];
/** Integrated loudness (LUFS) after ITU-R BS.1770; -Infinity when silent. */
export declare function integratedLoudness(
  samples: ArrayLike<number>,
  sampleRate: number
): number;
/** Scale to a loudness target (LUFS), never above a peak (default 0.98). */
export declare function normalizeLoudness(
  samples: Float32Array,
  sampleRate: number,
  target: number,
  options?: { peak?: number }
): { samples: Float32Array; gainDb: number; loudness: number };

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
    /**
     * Pronunciations for this call only, per language: IPA for en, ru and
     * hi, toned pinyin (one syllable per character) for zh. They win over
     * `addLexicon` and the shipped lexicons (`source: 'user'`). An entry
     * that cannot be read throws a TypeError naming the word.
     */
    lexicon?: CallLexicon;
    /** Speech markup: SSML is read unless false; true reads inline tags. */
    markup?: boolean;
  }
): Transcription;

// Pronunciation lexicons
/** Languages with a lexicon. */
export type LexiconLanguage = 'en' | 'ru' | 'hi' | 'zh';
/** Plain user entries: a pronunciation, or variants with the default first. */
export type LexiconEntries = Record<string, string | string[]>;
/** A front-coded lexicon container (see src/g2p/vslex.js). */
export interface VslexContainer {
  format: 'vslex';
  version: 1;
  lang: string;
  count: number;
  blockSize: number;
  alphabet: string;
  symbols: string;
  values: string[];
  first: string[];
  blocks: string[];
}
/** The JSON written by `build-lexicon.mjs --full` and `convert`. */
export interface FullLexicon {
  format: 'lexicon';
  version: 1;
  lang: string;
  count: number;
  words: Record<string, string[]>;
}
export type LexiconData = VslexContainer | FullLexicon | LexiconEntries;
export type CallLexicon = Partial<Record<LexiconLanguage, LexiconData>>;
export interface Lexicon {
  size: number;
  has(word: string): boolean;
  /** Every pronunciation of the word, the default first, or null. */
  lookup(word: string): string[] | null;
  words(): Iterator<string>;
}
export declare function openLexicon(data: LexiconData): Lexicon;
/**
 * The shipped lexicon: part `words` (en, hi), `forms` and `stems` (ru:
 * the stressed vowel of whole forms and of stems, issue 48; `stress` is
 * `forms`) or `phrases` (zh); null for an unknown language or part.
 */
export declare function lexiconFor(
  lang: LexiconLanguage | string,
  part?: string
): Lexicon | null;
/** Add a user lexicon; returns the number of words added. */
export declare function addLexicon(
  lang: LexiconLanguage,
  entries: LexiconData
): number;
export declare function clearLexicons(): void;
/**
 * Every known pronunciation (IPA), user lexicons first. English words that
 * the morphology derives from known words are not in the shipped lexicon
 * and give [] here (`conditioners`), though `textToIpa` reads them.
 */
export declare function pronunciations(
  lang: LexiconLanguage,
  word: string
): string[];
export declare function lexiconWords(lang: LexiconLanguage): Generator<string>;
/** Every lexicon word with exactly this IPA (derived words are not listed). */
export declare function spellingsOf(
  lang: LexiconLanguage,
  ipa: string
): string[];
/** Number of words in the shipped English lexicon. */
export declare function englishDictionarySize(): number;
export declare function detectLanguage(text: string): LanguageCode;
export declare function scriptLanguage(text: string): LanguageCode | null;
export declare function parseIpa(text: string): {
  tokens: object[];
  unknown: string[];
  /** Mode spans of the ExtIPA/VoQS marks and `ˈˈ`. */
  modes: ModeSpan[];
};
export declare function formatIpa(tokens: object[], modes?: ModeSpan[]): string;
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
    /** Mode spans (IPA word indexes) instead of those of the IPA marks. */
    modes?: ModeSpan[];
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
  | 'f0Rate'
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
/** A seeded mulberry32 generator; save/restore read and set its 32-bit state. */
export interface Random {
  (): number;
  save(): number;
  restore(state: number): void;
}
export declare function createRandom(seed?: string | number): Random;
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
  /**
   * The glottis state (SOURCE_STATE.LENGTH values with the 'lf' source,
   * empty with the folds). The noise generators are not part of it.
   */
  saveSources(): Float64Array;
  /**
   * Take over the state `saveSources()` of another renderer of the same
   * utterance returned (issue 29). An empty array changes nothing.
   */
  restoreSources(state: ArrayLike<number>): void;
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
  /**
   * Threads that step the 3D solver, the caller included: above 1 only for
   * the threads build (`voice-simulator-threads.wasm`, issue 24) with its
   * helper workers running.
   */
  threads: number;
  /** The helper workers of the threads build, else null. */
  pool: ThreadPool | null;
  /** End the helper workers (a no-op on one thread). Not during a render. */
  close(): void;
}
/** Helper workers of the threads build (issue 24). */
export interface ThreadPool {
  /** Threads in total, the caller included. */
  readonly size: number;
  /** Wake every helper into `vs_team_work(team, index)`. */
  run(team: number): void;
  /** End the workers and free their stacks. Not during a render. */
  close(): void;
}
/**
 * Start `count - 1` helper workers of the threads build on `memory`: a
 * module `Worker` in browsers, Bun and Deno, `node:worker_threads` in
 * Node.js. Each instantiates `module`, gets a 64 KiB stack from
 * `options.exports.vs_alloc` (the caller's instance) and sleeps in
 * `Atomics.wait` until `run(team)`. Rejects when a worker cannot start.
 * `loadEngineModule` with `threads` calls it.
 */
export declare function createThreadPool(
  module: WebAssembly.Module,
  memory: WebAssembly.Memory,
  count: number,
  options: {
    exports: Record<string, (...args: number[]) => number>;
    url?: URL | string;
  }
): Promise<ThreadPool>;
/**
 * Indices of the glottis state `saveSources()` returns (issue 29); RANDOM
 * is the state of its random generator, PARITY and PULSE_GAIN the double
 * pulsing of a creak, FALSETTO_SMOOTHED the falsetto low-pass and the
 * TILT_ values the memory of the spectral tilt filter of the effort.
 */
export declare const SOURCE_STATE: Readonly<{
  PHASE: 0;
  PERIOD: 1;
  JITTER: 2;
  SHIMMER: 3;
  SMOOTHED: 4;
  INTENSITY: 5;
  NOISE_MODULATION: 6;
  PULSE_TENSENESS: 7;
  RANDOM: 8;
  PARITY: 9;
  PULSE_GAIN: 10;
  FALSETTO_SMOOTHED: 11;
  TILT_INPUT: 12;
  TILT_MIDDLE: 13;
  TILT_OUTPUT: 14;
  LENGTH: 15;
}>;
/** Greatest common divisor of three sample rates (issue 29). */
export declare function switchGrid(a: number, b: number, c: number): number;
/** One tier switch of an AdaptiveStream. */
export interface StreamSwitch {
  /** Stream time (s) where the old tier stops: on the common grid. */
  at: number;
  from: number;
  level: number;
  /** 20 log10 of the gain matched over the crossfade. */
  gainDb: number;
  /** Correlation of the two tiers over the crossfade, 0 to 1. */
  r: number;
}
/** A renderer an AdaptiveStream drives. */
export interface StreamRenderer {
  readonly sampleRate: number;
  readonly totalSamples: number;
  readonly duration: number;
  readonly done: boolean;
  renderAsync(target: Float32Array, options?: object): Promise<number>;
  saveSources(): Float64Array;
  restoreSources(state: ArrayLike<number>): void;
}
export interface AdaptiveStreamOptions<R extends StreamRenderer> {
  /** A renderer of tier `level` with `extra` merged into its options. */
  createRenderer(level: number, extra: { startTime?: number }): R | Promise<R>;
  level: number;
  /** Output rate (Hz) whatever the tier. */
  streamRate: number;
  tiers?: readonly { sampleRate: number }[];
  /** Seconds the new tier renders before it is heard (default 0.03). */
  preroll?: number;
  /** Seconds of the crossfade (default 0.025). */
  overlap?: number;
  /** A room or an enclosure: longer preroll, the level only goes down. */
  room?: boolean;
  /** Options of every renderAsync call. */
  renderOptions?: object;
  /** Called after every piece (at most 256 samples) a renderer gives. */
  onRender?: (renderer: R) => void;
}
/**
 * One utterance at a fixed output rate whose audio tier can change while
 * it renders (issue 29): the new tier starts at a time on the common grid
 * of the three rates with the source state of the old one and takes over
 * after a level-matched crossfade. The length never changes.
 */
export declare class AdaptiveStream<R extends StreamRenderer = EngineRenderer> {
  static create<R extends StreamRenderer>(
    options: AdaptiveStreamOptions<R>
  ): Promise<AdaptiveStream<R>>;
  constructor(options: AdaptiveStreamOptions<R>);
  readonly ready: Promise<void>;
  readonly level: number;
  readonly streamRate: number;
  /** Stream samples written so far. */
  readonly position: number;
  readonly totalSamples: number;
  readonly done: boolean;
  /** The renderer that is heard. */
  readonly renderer: R;
  readonly switches: StreamSwitch[];
  /**
   * Ask for another tier; false (and nothing changes) during a switch, at
   * the same level, when the grid of the rates is below 20 Hz, or upwards
   * with `room`. A request too close to the end is dropped later.
   */
  setLevel(level: number): boolean;
  /** Fill `target` from `position` on; resolves to the samples written. */
  render(target: Float32Array): Promise<number>;
  close(): void;
}
/** Pages (64 KiB) of the shared memory of the threads build. */
export declare const THREAD_MEMORY: Readonly<{
  INITIAL: 512;
  MAXIMUM: 16384;
  PAGE_BYTES: 65536;
}>;
/** The most threads `threads: 'auto'` asks for. */
export declare const AUTO_THREADS_MAX: number;
/**
 * The thread count of the `threads` option: 1 by default, a positive
 * integer as given, `'auto'` = max(1, cores - 1), at most
 * AUTO_THREADS_MAX. Throws an Error for anything else.
 */
export declare function requestedThreads(threads?: number | 'auto'): number;
/**
 * Run `action` (a render call of renderer `handle`) with a thread team of
 * the engine's pool when there is one and the grid has at least
 * `minLinks` links (default THREAD_MIN_LINKS of the engine).
 */
export declare function withTeam<T>(
  module: EngineModule,
  handle: number,
  action: () => T,
  minLinks?: number
): { result: T; threads: number };
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
 *
 * `threads` (default 1; a positive integer, or `'auto'` for all cores but
 * one, at most AUTO_THREADS_MAX) asks for the threads build
 * `voice-simulator-threads.wasm` (issue 24) with `threads - 1` helper
 * workers. A request that cannot be met is never an error: without the
 * file, without cross-origin isolation (`crossOriginIsolated` false), without
 * SharedArrayBuffer, or when a worker cannot start, the engine loads as
 * without `threads` and `threads` of the result is 1. Call `close()` on the
 * result to end the workers.
 */
export declare function loadEngineModule(
  source?: WebAssembly.Module | BufferSource | URL | string | null,
  options?: { simd?: 'auto' | boolean; threads?: number | 'auto' }
): Promise<EngineModule | null>;
/**
 * loadEngineModule without a promise: reads and compiles synchronously
 * where `process.getBuiltinModule` exists (Node.js, Bun, Deno); elsewhere
 * (browsers) it returns undefined ("cannot tell without awaiting"). It
 * loads only the files without threads, so `threads` of its result is 1.
 */
export declare function loadEngineModuleSync(
  source?: WebAssembly.Module | BufferSource | URL | string | null,
  options?: { simd?: 'auto' | boolean; threads?: number | 'auto' }
): EngineModule | null | undefined;

// The engine choice: Rust by default, JavaScript as the fallback (issue 25)
/**
 * `'auto'` (Rust when it loads, else JavaScript), `'rust'` (an error when
 * it does not load) or `'js'` (never loads WebAssembly).
 */
export type EngineName = 'auto' | 'rust' | 'js';
/** The values of the `engine` option. */
export declare const ENGINE_NAMES: readonly EngineName[];
/** Options of createEngine and getEngine. */
export interface EngineOptions {
  engine?: EngineName | Engine;
  /** A positive integer or `'auto'` (default 1). */
  threads?: number | 'auto';
  /** Default `'auto'`. */
  simd?: 'auto' | boolean;
  /** As for loadEngineModule; an engine from a source is not cached. */
  source?: WebAssembly.Module | BufferSource | URL | string | null;
}
/** A renderer of an engine: it says which engine renders and why. */
export type EngineRenderer = (VoiceRenderer | RustVoiceRenderer) & {
  /** The engine that renders this renderer. */
  engine: 'rust' | 'js';
  /** Why it is not Rust (null when it is, or when `'js'` was asked for). */
  fallbackReason: string | null;
};
/** A rendering engine: the Rust engine or the JavaScript renderer. */
export declare class Engine {
  constructor(settings: {
    name: 'rust' | 'js';
    requested: EngineName;
    module?: EngineModule | null;
    reason?: string | null;
    key?: string | null;
  });
  /** The engine that renders. */
  readonly name: 'rust' | 'js';
  /** The `engine` option it was created for. */
  readonly requested: EngineName;
  /** Whether the Rust engine was built with WebAssembly SIMD. */
  readonly simd: boolean;
  /**
   * Threads that can step the 3D solver: `threads` of its EngineModule
   * (the threads build with its helpers, issue 24), else 1.
   */
  readonly threads: number;
  /** Why the engine is JavaScript under `'auto'`, else null. */
  readonly reason: string | null;
  readonly module: EngineModule | null;
  /** Optional engine features in use. */
  features(): string[];
  /** Why this engine renders the options in JavaScript, or null. */
  supports(renderOptions?: RenderOptions): string | null;
  /**
   * A RustVoiceRenderer when this is the Rust engine and it supports the
   * options, else a VoiceRenderer. Free a Rust renderer with `free()`.
   */
  createRenderer(plan: Plan, renderOptions?: RenderOptions): EngineRenderer;
  /** Drop the engine and its cache entry, and end its helper threads. */
  close(): void;
}
/**
 * Load an engine, cached by `engine|threads|simd`. `'rust'` rejects with
 * an Error whose `code` is `'ENGINE_UNAVAILABLE'` when it does not load. An
 * engine object is returned as it is.
 */
export declare function createEngine(
  options?: EngineName | Engine | EngineOptions
): Promise<Engine>;
/**
 * createEngine without a promise: the cached engine, else a synchronous
 * load where the runtime allows it (Node.js, Bun, Deno). In browsers
 * `'auto'` gives JavaScript until `await createEngine()` has run.
 */
export declare function getEngine(
  options?: EngineName | Engine | EngineOptions
): Engine;
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
  constructor(
    module: EngineModule,
    plan: Plan,
    options?: RenderOptions & {
      /** Overrides THREAD_MIN_LINKS (0: a team for any grid). */
      threadMinLinks?: number;
    }
  );
  readonly sampleRate: number;
  readonly sections: number;
  readonly duration: number;
  readonly done: boolean;
  readonly totalSamples: number;
  position: number;
  /** Milliseconds spent preparing frames in JavaScript so far. */
  readonly prepareTime: number;
  /**
   * Threads that stepped the solver in the last render() call: above 1 only
   * on an engine of `threads` above 1 with a grid of at least
   * THREAD_MIN_LINKS links (or `threadMinLinks`).
   */
  readonly threads: number;
  render(target: Float32Array): number;
  renderAsync(target: Float32Array): Promise<number>;
  /** As VoiceRenderer.saveSources (`vs_renderer_sources_save`). */
  saveSources(): Float64Array;
  /** As VoiceRenderer.restoreSources (`vs_renderer_sources_restore`). */
  restoreSources(state: ArrayLike<number>): void;
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
  /** Vocal effort (dB). */
  effort?: number;
  /** Offset of the LF tenseness (positive pressed, negative lax). */
  tension?: number;
  /** Phonation channels 0 … 1 (issue 54). */
  breath?: number;
  creak?: number;
  falsetto?: number;
  harsh?: number;
  /**
   * Whisper 0 … 1 (the plan channel `whisper`, issue 53): the voiced part
   * is multiplied by `1 - whisper` (at 1 no pulses, the phase stands
   * still) and the noise of a half-open glottis is added.
   */
  whisper?: number;
  /** Noise sample of the whisper source; default the `noise` argument. */
  whisperNoise?: number;
  /** Closure of the mouth 0 … 1: a voiced stop closure halves the whisper. */
  stopClosure?: number;
  /** Frication of the mouth 0 … 1: weakens the whisper of a fricative. */
  fricative?: number;
}
/** Breath noise per 10 mm² of glottal chink. */
export declare const CHINK_NOISE: number;
/** Breath noise: BREATH_GAIN * breathiness ** BREATH_EXPONENT. */
export declare const BREATH_GAIN: number;
export declare const BREATH_EXPONENT: number;
/** Lowest f0 (Hz) of a glottal period (20). */
export declare const MIN_F0: number;
/** Source constants of the phonation channels (issue 54). */
export declare const PHONATION_SOURCE: Readonly<{
  creakSemitones: number;
  creakFloor: number;
  creakJitter: number;
  creakPulseGain: number;
  creakPulseLength: number;
  falsettoSemitones: number;
  falsettoDecibels: number;
  falsettoCorner: number;
  harshJitter: number;
  harshShimmer: number;
  harshBreath: number;
  breathNoise: number;
}>;
/** f0 shifted by -12 st of creak (not below 25 Hz) and +12 st of falsetto. */
export declare function phonationF0(
  f0: number,
  creak: number,
  falsetto: number
): number;
/** Breathiness of the noise: head value plus 0.6 (breath + 0.3 harsh). */
export declare function noiseBreathiness(
  breathiness: number,
  breath?: number,
  harsh?: number
): number;
export type PhonationType =
  | 'breathy'
  | 'lax'
  | 'pressed'
  | 'creaky'
  | 'falsetto'
  | 'harsh';
/** Source channels of a phonation type at degree 1. */
export interface PhonationTarget {
  rd: number;
  breath?: number;
  creak?: number;
  falsetto?: number;
  harsh?: number;
}
/** Rd and channels of each phonation type at degree 1 (issue 54). */
export declare const PHONATION: Readonly<
  Record<PhonationType, Readonly<PhonationTarget>>
>;
/** 'breath', 'creak', 'falsetto', 'harsh'. */
export declare const PHONATION_CHANNELS: readonly string[];
/** Degree of a segment written with a̤ or a̰ (0.67). */
export declare const SEGMENT_DEGREE: number;
/** Rd of the speaker's own voice (3 (1 - tenseness) plus the breathiness). */
export declare function voiceRd(head?: HeadConfig): number;
/** Source channels of a mode (and token) for a head. */
export declare function phonationChannels(
  mode: Mode | null | undefined,
  token: object | null | undefined,
  head?: HeadConfig
): {
  tension: number;
  breath: number;
  creak: number;
  falsetto: number;
  harsh: number;
};
// Emotions and attitudes (issue 55, docs/markup.md#emotions-and-attitudes)
/** A row of EMOTION_PRESETS: the changes at intensity 1. */
export interface EmotionPreset {
  /** Pitch shift in semitones. */
  pitch: number;
  /** Factor on the pitch movements. */
  range: number;
  /** Speech rate factor. */
  rate: number;
  /** Vocal effort 0 … 1 (0.5 normal). */
  effort: number;
  /** Degrees of the phonation types; `tension` -1 (lax) … 1 (pressed). */
  phonation: Readonly<Partial<Phonation>>;
  /** Factor on every pause inside the span. */
  pauses: number;
  /** Vowels away from [ə] (> 0) or towards it (< 0). */
  precision: number;
  /** Lip spreading 0 … 1. */
  smile: number;
  /** Pitch movement (st/s) inside each primary-stressed vowel. */
  glide: number;
  /** Pitch movement (st/s) on the last vowel of the span. */
  finalRise: number;
  /** Factor on the primary-stressed vowels. */
  stressLength: number;
  /** Extra jitter in percent (realised as harsh voice). */
  jitter: number;
  arousal: number;
  valence: number;
  dominance: number;
  /** Where arousal, valence and dominance come from. */
  coordinates: string;
  /** Where the row comes from, e.g. 'Burkhardt & Sendlmeier 2000'. */
  source: string;
  /** Whether listeners recognised the row in a published study. */
  verified: boolean;
}
/** The changes of an emotion (`emotionChanges`). */
export type EmotionChanges = Omit<
  EmotionPreset,
  'arousal' | 'valence' | 'dominance' | 'coordinates' | 'source' | 'verified'
> & { phonation: Partial<Phonation> };
/**
 * The twelve presets: neutral, angry, happy, sad, afraid, bored,
 * surprised, disgusted, tender, sarcastic, confident, hesitant.
 */
export declare const EMOTION_PRESETS: Readonly<
  Record<string, Readonly<EmotionPreset>>
>;
/** Limit of a glide or final rise in semitones (3). */
export declare const GLIDE_LIMIT: number;
/** Vowel spreading per unit of precision above (0.3) and below (0.2) 0. */
export declare const PRECISION: Readonly<{ up: number; down: number }>;
/** Lip changes of smile 1: rounding -0.3 and retraction 1.2 cm. */
export declare const SMILE: Readonly<{ rounding: number; retraction: number }>;
/** Time a pitch rise of d st needs: base + perSemitone · d seconds. */
export declare const RISE_TIME: Readonly<{ base: number; perSemitone: number }>;
/**
 * What an emotion changes: a named preset at its intensity (1 when not
 * given), or the rules of arousal, valence and dominance for 'neutral'.
 */
export declare function emotionChanges(
  emotion?: string | Partial<Emotion>
): EmotionChanges;
/** Whether an emotion changes nothing (neutral at the origin, or intensity 0). */
export declare function isNeutralEmotion(
  emotion: Partial<Emotion> | null | undefined
): boolean;
/**
 * The mode with its emotion realised as an outer span; the same object
 * when the emotion changes nothing.
 */
export declare function realiseEmotion<T extends Mode | null | undefined>(
  mode: T
): T extends Mode
  ? Mode & {
      emotionPitch?: number;
      emotionRange?: number;
      emotionEffort?: number;
      pauses?: number;
      stressLength?: number;
      glide?: number;
      finalRise?: number;
      precision?: number;
      smile?: number;
    }
  : T;
/** Release of a breathy-voiced stop (bʱ dʱ ɖʱ ɡʱ dʒʱ). */
export declare const BREATHY_RELEASE: Readonly<{
  duration: number;
  rd: number;
  breath: number;
  pitch: number;
}>;
/** Onset (0.8) and width (0.1) of the phrase-final creak, times the pitch. */
export declare const FINAL_CREAK: Readonly<{ onset: number; width: number }>;
/** Creak of `finalCreak` at f0 (Hz) for a speaker pitch (Hz). */
export declare function finalCreakAmount(
  f0: number,
  pitch: number,
  finalCreak: number
): number;
export declare class Glottis {
  constructor(options?: GlottisOptions);
  step(dt: number, control: GlottisControl, noise: number): number;
  /** Tenseness of the running period. */
  pulseTenseness: number;
  /** The SOURCE_STATE.LENGTH values in the order of SOURCE_STATE. */
  saveState(): Float64Array;
  /** Set what saveState returned and rebuild the pulse shape. */
  restoreState(state: ArrayLike<number>): void;
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
/** A shorter lag that scores at least this share of the best one is the period. */
export declare const SUBHARMONIC_TOLERANCE: number;
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

// Recognition front end (issue 58): analysis frames of a recording or a
// stream; see src/recognition/frontend.d.ts.
export { createFft, type Fft } from './recognition/fft.js';
export {
  lpcAutocorrelation,
  lpcBurg,
  lpcCovariance,
  lpcLevel,
  predictorFromReflection,
  type LpcArray,
  type LpcMethod,
} from './recognition/lpc.js';
export {
  FRONTEND_DEFAULTS,
  analyzeFrames,
  createFrameAnalyzer,
  workingRate,
  type FrameAnalyzer,
  type FrameSet,
  type FrameStage,
  type FrontendOptions,
} from './recognition/frontend.js';
// Pitch and voicing tracker (issue 59); see src/recognition/pitch.d.ts.
export {
  PITCH_DEFAULTS,
  createPitchTracker,
  jitterToHead,
  trackPitch,
  type PitchOptions,
  type PitchTrack,
  type PitchTracker,
} from './recognition/pitch.js';
// Formant tracker (issue 60); see src/recognition/formants.d.ts.
export {
  FORMANT_DEFAULTS,
  NASAL_BAND_DROP,
  NASAL_HIGH_DROP,
  NASAL_RATIO,
  createFormantTracker,
  tractLengthFromFormants,
  trackFormants,
  type FormantOptions,
  type FormantTrack,
  type FormantTracker,
} from './recognition/formants.js';

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
/**
 * The GPU stage of chooseTierWithGpu on its own: the accelerated tiers
 * above `cpu.level` measured with `measure`; nothing without `gpu`.
 */
export declare function chooseGpuTier<T>(
  measure: (tier: T, options: { limit: number }) => Promise<number> | number,
  cpu: TierChoice,
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
/**
 * The tier of a running utterance (issue 29): down within `downAfter`
 * (0.1 s) of a load above `target`, up one level after `upAfter` (3 s) of
 * headroom, never back to a level it left.
 */
export declare class StreamGovernor<T extends { cost: number } = AudioTier> {
  constructor(options?: {
    tiers?: readonly T[];
    level?: number;
    maxLevel?: number;
    target?: number;
    smoothing?: number;
    downAfter?: number;
    upAfter?: number;
    margin?: number;
  });
  level: number;
  readonly maxLevel: number;
  /** The highest level it may go up to: below every level it left. */
  readonly ceiling: number;
  /** Smoothed busy / audio, null before the first record. */
  readonly load: number | null;
  /** Seconds of audio since the last switch. */
  readonly since: number;
  /** A level to switch to, or null. */
  record(busy: number, audio: number): number | null;
  /** The player ran dry: one level down, or null at level 0. */
  underrun(): number | null;
  /** The stream switched to `level`: the load is predicted for it. */
  switched(level: number): void;
}
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
    /** Default `'auto'`; see createEngine. */
    engine?: EngineName | Engine;
  }
): number;
export declare function benchmarkAudioTiers(options?: {
  target?: number;
  head?: HeadConfig;
  seconds?: number;
  repeats?: number;
  /** Seconds spent rendering the cheap tiers before measuring (default 0). */
  warmUp?: number;
  /** Default `'auto'`; see createEngine. */
  engine?: EngineName | Engine;
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
    engine?: EngineName | Engine;
  }
): Promise<number>;
/** benchmarkAudioTiers with the 3D tiers on a WebGPU `device` when given. */
export declare function benchmarkAudioTiersAsync(options?: {
  target?: number;
  head?: HeadConfig;
  seconds?: number;
  device?: GPUDeviceLike | null;
  engine?: EngineName | Engine;
}): Promise<GpuTierChoice & { tier: AudioTier }>;
/** The utterance every benchmark renders. */
export declare const BENCHMARK_IPA: string;
/**
 * Renderer for the first `seconds` (default 0.3) of the benchmark
 * utterance, with the voxel model `model` (built when not given) for the
 * 3D tiers.
 */
export declare function benchmarkRenderer(
  tier: AudioTier,
  options?: {
    head?: HeadConfig;
    ipa?: string;
    seconds?: number;
    device?: GPUDeviceLike | null;
    engine?: EngineName | Engine;
    model?: object | null;
  }
): EngineRenderer;

// Silent device benchmark (issue 28)
/** Version of the benchmarkDevice procedure; cached results of another are measured again. */
export declare const BENCHMARK_VERSION: number;
/** The renderer a fake `measure` of benchmarkDevice returns (tests). */
export interface BenchmarkProbeRenderer {
  sampleRate: number;
  /** Renders into `block`, returns the samples written. */
  render(block: Float32Array): number;
  done?: boolean;
  free?(): void;
}
export interface BenchmarkDeviceOptions {
  /** Default `'auto'`; see createEngine. */
  engine?: EngineName | Engine;
  head?: HeadConfig;
  /** Largest load of a chosen tier (default 0.8). */
  target?: number;
  /** CPU seconds the benchmark may spend (default 1). */
  budget?: number;
  /** Seconds of work between pauses (default 0.02). */
  slice?: number;
  /** Seconds of audio per tier (default 0.06). */
  probe?: number;
  /** Last tier to consider (default the last one). */
  maxLevel?: number;
  /** A partial result to continue. */
  resume?: DeviceBenchmark | null;
  /** True when speech is waiting: the benchmark returns a partial result. */
  paused?: () => boolean;
  /** Clock in ms (default performance.now). */
  now?: () => number;
  /** Called between slices (default: setTimeout 0). */
  pause?: () => Promise<void>;
  /** Makes the renderer of a probe (tests). */
  measure?: (
    tier: AudioTier,
    info: {
      warmup: boolean;
      index: number;
      seconds: number;
      head?: HeadConfig;
      engine: Engine;
    }
  ) => BenchmarkProbeRenderer;
  /** Default AUDIO_TIERS. */
  tiers?: readonly AudioTier[];
}
export interface DeviceBenchmark {
  version: number;
  engine: { name: string; simd: boolean; threads: number };
  /** The chosen level (index in AUDIO_TIERS). */
  level: number;
  tier: AudioTier;
  /** Load of every tier up to maxLevel; predicted where not measured. */
  loads: number[];
  measured: boolean[];
  /** CPU seconds spent, summed over the slices. */
  cpuSeconds: number;
  /** Seconds of the longest slice. */
  longestSlice: number;
  /** Stopped by `paused()`; pass it as `resume` to continue. */
  partial: boolean;
}
/**
 * Measure, in slices and within a CPU budget, how fast this device renders
 * each audio tier and choose the most precise one with 20 % headroom.
 */
export declare function benchmarkDevice(
  options?: BenchmarkDeviceOptions
): Promise<DeviceBenchmark>;
/**
 * The highest level whose load is at most `target` (measured) or
 * 0.7 × `target` (predicted), every lower level passing too; 0 if none.
 */
export declare function chooseLevel(
  loads: readonly number[],
  measured: readonly boolean[],
  target?: number
): number;
/**
 * The level automatic quality starts at before the benchmark answers:
 * `narrowband` with at most 2 cores or 2 GB of memory, else `minimal`.
 */
export declare function startLevel(hints?: {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}): number;
/** `medium` when the battery is not charging and below 20 %, else the last level. */
export declare function batteryLevelCap(
  battery?: { charging?: boolean; level?: number } | null
): number;

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
  createResampler,
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
export {
  ACCENT_FORMAT,
  ACCENT_VERSION,
  MAX_ACCENT_RULES,
  accentSettings,
  applyAccent,
  explainAccent,
  foreignAccent,
  getAccent,
  loadAccent,
} from './accent/index.js';
export type {
  AccentDefinition,
  AccentOption,
  AccentRule,
  AccentSettings,
} from './accent/index.js';
/** The first-language profiles of the foreign accents. */
export declare const ACCENT_PROFILES: Readonly<Record<LanguageCode, object>>;
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
/** Where the stress of a Russian word comes from. */
export type RussianStressSource =
  | 'user'
  | 'dictionary'
  | 'morphology'
  | 'rules';
/** The words around a word in its clause, lower case, `before` nearest first. */
export interface RussianStressContext {
  before?: string[];
  after?: string[];
}
/**
 * The stress of a Russian word (issue 48), in this order: a typed mark
 * (`+` before the vowel or U+0301 after it), a typed `ё`, a homograph chosen
 * by the context (`RUSSIAN_HOMOGRAPHS`), a whole form (lexicon part
 * `forms`, also with one `е` read as `ё` when exactly one such spelling is
 * known), the longer of a stem (part `stems`) with an ending of
 * `RUSSIAN_ENDINGS` and such a stem with `ё`, and the guess of
 * `guessRussianStress()`. `letters` has the restored `ё`;
 * `stress` is the index of the stressed vowel.
 */
export declare function findRussianStress(
  word: string,
  context?: RussianStressContext
): {
  letters: string;
  stress: number;
  vowels: number;
  source: RussianStressSource;
};
/**
 * Guess the stressed vowel (index) of a lower-case Russian word from the
 * word endings of the lexicon; without a match the vowel before the last.
 */
export declare function guessRussianStress(
  word: string,
  vowels?: number
): number;
/** The endings split off a Russian word to find its stem. */
export declare const RUSSIAN_ENDINGS: readonly string[];
/** Words before a homograph that make it genitive singular. */
export declare const GENITIVE_BEFORE: string;
/** Words before a homograph that make it nominative plural. */
export declare const PLURAL_BEFORE: string;
/**
 * Russian homographs: rows `[forms, kind, cues]`, `forms` the
 * `default/other` pairs (`з+амок/зам+ок`), `kind` how `cues` choose the
 * other form.
 */
export declare const RUSSIAN_HOMOGRAPHS: readonly (readonly [
  readonly string[],
  'near' | 'before' | 'after' | 'infinitive' | 'case',
  string,
])[];
/** Whether a lower-case spelling (`е` for `ё`) is a Russian homograph. */
export declare function isRussianHomograph(spelling: string): boolean;
/** The marked form of a homograph in its context, or undefined. */
export declare function russianHomograph(
  spelling: string,
  context?: RussianStressContext
): string | undefined;
export declare const BOUNDARIES: Readonly<Record<string, object>>;
export declare const CONTOURS: Readonly<Record<string, object>>;
export declare function boundaryOf(pause: object | null | undefined): string;
export declare function pauseDuration(pause: object): number;
export declare function intonationPhrases(segments: object[]): object[];
/** Name of a tune: the generic names and the Russian IK1 to IK7. */
export type TuneName =
  | 'statement'
  | 'wh'
  | 'yesno'
  | 'echo'
  | 'continuation'
  | 'alt-rise'
  | 'tag-ask'
  | 'tag-confirm'
  | 'exclamation'
  | 'command'
  | 'parenthesis'
  | 'call'
  | 'IK1'
  | 'IK2'
  | 'IK3'
  | 'IK4'
  | 'IK5'
  | 'IK6'
  | 'IK7';
/** Intonation tunes per language (issue 51), in semitones at `pitchRange` 3. */
export declare const TUNES: Readonly<{
  en: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  ru: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  hi: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  zh: Readonly<Record<string, Readonly<Record<string, number>>>>;
}>;
/** Focus per language: pitch, duration and gain of the focus, compression after it. */
export declare const FOCUS: Readonly<
  Record<'en' | 'ru' | 'hi' | 'zh', Readonly<Record<string, number | boolean>>>
>;
/** Approach rate (per second) of the intonation targets. */
export declare const INTONATION_RATE: number;
/** Every tune name of `TUNES.en` and `TUNES.ru`. */
export declare const TUNE_NAMES: readonly TuneName[];
/** The intonation language of a language tag: 'en', 'ru', 'hi' or 'zh'. */
export declare function intonationLanguage(
  language?: string | null
): 'en' | 'ru' | 'hi' | 'zh';
/** The generic tune name of phrase `index` from its punctuation. */
export declare function phraseTuneName(
  phrases: object[],
  index: number,
  language?: string
): TuneName;
/** Intonation phrases with tune, focus, syllables and nucleus. */
export declare function analyzeIntonation(
  segments: object[],
  language?: string
): object[];
/** Conjunctions before which a long stretch is broken with `|`. */
export declare const PHRASE_CONJUNCTIONS: Readonly<
  Record<string, readonly string[]>
>;
/** Conjunction of alternative questions per language (`or`, `или`, `या`, `还是`). */
export declare const ALTERNATIVE_CONJUNCTIONS: Readonly<Record<string, string>>;
/** English auxiliaries that open a yes/no question. */
export declare const ENGLISH_AUXILIARIES: readonly string[];
/** A stretch longer than this many syllables gets a `|` break. */
export declare const MAX_PHRASE_SYLLABLES: number;
/** Each side of a `|` break keeps at least this many syllables. */
export declare const MIN_PHRASE_SYLLABLES: number;
/** The auxiliary of an English word (`aren't` gives `are`), or null. */
export declare function englishAuxiliary(word: string): string | null;
/** Marks sentence types, tunes and phrase breaks on g2p items (in place). */
export declare function markPhrasing(items: object[]): void;
/** Mandarin question words: a question with one of them falls. */
export declare const ZH_WH_WORDS: readonly string[];
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

export {
  inverseFilter,
  INVERSE_FILTER_DEFAULTS,
  rdToTenseness,
  lfHarmonics,
  type InverseFilterOptions,
  type InverseFilterResult,
  type SourceMeasure,
  type SourceSummary,
} from './recognition/inverse-filter.js';

// Simulator-generated articulatory codebook (issue 64).
export {
  buildCodebook,
  serializeCodebook,
  parseCodebook,
  frameEnvelope,
  CODEBOOK_CHANNELS,
  GRID,
  tractResponse,
  type Codebook,
  type CodebookOptions,
  type CodebookStats,
  type CodebookChannel,
  type CodebookQuery,
  type CodebookFrame,
} from './recognition/codebook.js';
