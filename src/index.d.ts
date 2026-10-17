/**
 * Type definitions for voice-simulator: physical 3D voice simulation.
 */

export type LanguageCode = 'en' | 'ru' | 'hi' | 'zh';
export type HeadConfig = Record<string, number>;
export type SolverName = 'waveguide' | 'fdtd3d';
export type OutputMode = 'flow' | 'microphone';

export interface Language {
  code: LanguageCode;
  name: string;
  native: string;
  sample: string;
}

export interface Word {
  text: string;
  lang: string;
  ipa: string;
  source?: string;
  pinyin?: string;
  /** The written text the word was read from (before verbalisation). */
  original?: string;
  sourceStart?: number;
  sourceEnd?: number;
  token?: number;
  linkingR?: boolean;
}

export type AccentCode = 'en-US' | 'en-GB' | 'en-AU' | 'en-IN';

export interface Transcription {
  lang: string;
  /** English accent; null for other languages. */
  accent?: AccentCode | null;
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
}

export interface TimelineWord {
  text: string;
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
  seed?: string | number;
  blockSize?: number;
  head?: HeadConfig;
  dx?: number;
  model?: object;
  output?: OutputMode;
}

export interface SynthesizeOptions {
  lang?: 'auto' | LanguageCode;
  /** English accent (code or region such as "GB"). */
  accent?: AccentCode | string;
  /** Treat the text as IPA. */
  ipa?: boolean;
  head?: HeadConfig | 'random';
  seed?: string | number;
  tier?: string | number;
  solver?: SolverName;
  sections?: number;
  dx?: number;
  sampleRate?: number;
  output?: OutputMode;
  model?: object;
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
  options?: { lang?: 'auto' | LanguageCode; accent?: AccentCode | string }
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
export declare const CHANNELS: Readonly<Record<string, object>>;
export declare const TRACT_SECTIONS: number;
export declare function planUtterance(
  ipa: string | object[],
  options?: { head?: HeadConfig; language?: string; frameRate?: number }
): Plan;
export declare function sampleState(
  plan: Plan,
  time: number,
  target?: Record<string, number>
): Record<string, number>;
export declare function tractShape(
  state: Record<string, number>,
  head: HeadConfig,
  options?: { sections?: number }
): {
  areas: Float64Array;
  length: number;
  velumArea: number;
  velumIndex: number;
  frication: { position: number; gain: number; sibilance: number };
  glottis: Record<string, number>;
};
export declare function noseShape(
  head: HeadConfig,
  sections?: number
): { areas: Float64Array; length: number };

// Head configuration
export interface HeadParameter {
  key: string;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  description?: string;
}
export declare const HEAD_PARAMETERS: readonly HeadParameter[];
export declare const DEFAULT_HEAD: Readonly<HeadConfig>;
export declare function normalizeHeadConfig(config?: HeadConfig): HeadConfig;
export declare function randomHeadConfig(seed: string | number): HeadConfig;
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
  step(glottalFlow: number, noisePosition: number, noise: number): number;
  /** Optional pressure snapshot for visualisation. */
  field?(): object;
  reset(): void;
}
export declare class VoiceRenderer {
  constructor(plan: Plan, options?: RenderOptions);
  readonly solver: Solver;
  readonly sampleRate: number;
  readonly duration: number;
  readonly done: boolean;
  readonly totalSamples: number;
  position: number;
  render(target: Float32Array): number;
}
export declare function renderPlan(
  plan: Plan,
  options?: RenderOptions
): Float32Array;
export declare function registerSolver(
  name: string,
  factory: (options: object) => Solver
): void;
export declare class Waveguide implements Solver {
  constructor(options?: { sections?: number; noseSections?: number });
  setShape(
    areas: ArrayLike<number>,
    velumArea: number,
    velumIndex?: number
  ): void;
  setNose(areas: ArrayLike<number>): void;
  step(glottalFlow: number, noisePosition: number, noise: number): number;
  /** Pressure per tract and nose section, for visualisation. */
  field(): { pressure: Float64Array; nose: Float64Array };
  reset(): void;
}
export declare class Fdtd3d implements Solver {
  constructor(options?: {
    head?: HeadConfig;
    dx?: number;
    model?: object;
    output?: OutputMode;
  });
  stepDuration(): number;
  setShape(areas: ArrayLike<number>, velumArea: number): void;
  setNose(areas: ArrayLike<number>): void;
  step(glottalFlow: number, noisePosition: number, noise: number): number;
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
  options?: { dx?: number }
): object;
export declare class Glottis {
  constructor(options?: { seed?: string | number; head?: HeadConfig });
  step(dt: number, control: Record<string, number>, noise: number): number;
}
export declare function tubeFormants(
  areas: ArrayLike<number>,
  length: number,
  options?: object
): number[];
export declare function tubeSpectrum(
  areas: ArrayLike<number>,
  length: number,
  options?: object
): { frequencies: Float64Array; magnitudes: Float64Array };
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
  samples: Float32Array,
  sampleRate: number
): Uint8Array;
export declare function decodeWav(bytes: Uint8Array): {
  sampleRate: number;
  samples: Float32Array;
};
export declare function wavHeader(
  sampleRate: number,
  dataLength?: number,
  channels?: number
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
  options: { sections: number; velumDistance: number; length: number }
): Path;
export declare function headMesh(
  head?: HeadConfig,
  options?: { lod?: number }
): Mesh;
export declare function tubeMesh(
  path: Path,
  areas: ArrayLike<number>,
  options?: { lod?: number; head?: HeadConfig }
): Mesh;
export declare function updateTubeMesh(
  mesh: Mesh,
  path: Path,
  areas: ArrayLike<number>,
  options?: { lod?: number; head?: HeadConfig }
): Mesh;
export declare function lipsMesh(
  head?: HeadConfig,
  options?: { area?: number; lod?: number }
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
  options?: { lod?: number; state?: Record<string, number> }
): (Mesh & { name: string })[];
export declare function headModelObj(
  head: HeadConfig,
  options?: { lod?: number; state?: Record<string, number> }
): string;

// Levels of detail
export declare const AUDIO_TIERS: readonly AudioTier[];
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
  options?: { tiers?: readonly T[]; target?: number; skip?: number }
): { level: number; loads: number[]; measured: boolean[] };
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
/** Load of a tier; stops early once the load exceeds `limit`. */
export declare function measureAudioTier(
  tier: AudioTier,
  options?: {
    head?: HeadConfig;
    ipa?: string;
    seconds?: number;
    limit?: number;
  }
): number;
export declare function benchmarkAudioTiers(options?: {
  target?: number;
  head?: HeadConfig;
  seconds?: number;
}): {
  level: number;
  tier: AudioTier;
  loads: number[];
  measured: boolean[];
};

// Linguistics: text normalisation, accents, prosody, syllables, timeline
export declare const VERBALIZERS: Readonly<Record<LanguageCode, object>>;
export declare function normalizeText(
  text: string,
  options: { lang: string; wordLanguage: (word: string) => string }
): object[];
export declare const ACCENTS: Readonly<{
  en: readonly { code: AccentCode; name: string; native: string }[];
}>;
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
