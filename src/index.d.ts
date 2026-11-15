/**
 * Type definitions for voice-simulator: physical 3D voice simulation.
 */

export type LanguageCode = 'en' | 'ru' | 'hi' | 'zh';
export type HeadConfig = Record<string, number>;
export type SolverName = 'waveguide' | 'fdtd3d';
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
  seed?: string | number;
  blockSize?: number;
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
  /** English accent (code or region such as "GB"). */
  accent?: AccentCode | string;
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
  sections?: number;
  dx?: number;
  sampleRate?: number;
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
    accent?: AccentCode | string;
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
  options?: { sections?: number; teeth?: boolean }
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
  step(glottalFlow: number, noisePosition: number, noise: number): number;
  /** Queue a step; its output comes with the next flushSteps. */
  queueStep?(glottalFlow: number, noisePosition: number, noise: number): void;
  flushSteps?(options?: { field?: boolean }): Promise<Float64Array>;
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
  });
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
    microphone?: MicrophoneOptions;
    enclosure?: EnclosureOptions;
    kernel?: 'wasm' | 'js';
    /** Run the step loop on this WebGPU device (queueStep/flushSteps). */
    device?: GPUDeviceLike;
    /** `false` leaves out the piriform fossae. */
    piriform?: boolean;
    /** `false` leaves out the vallecula. */
    vallecula?: boolean;
  });
  /** The GPU step loop, with a `device`. */
  readonly gpu: FdtdGpu | null;
  /** Distance of the receiver from the lips (cm), with a microphone. */
  readonly microphoneDistance?: number;
  /** True when the grid contains the enclosure walls. */
  readonly simulatesEnclosure: boolean;
  /**
   * Seconds per step; with a shape the grid runs slower by its length over
   * the rest length so the formants follow the tract length.
   */
  stepDuration(shape?: { length?: number }): number;
  setShape(
    areas: ArrayLike<number>,
    velumArea: number,
    velumIndex?: number,
    teeth?: { gap: number } | null
  ): void;
  setNose(areas: ArrayLike<number>): void;
  step(glottalFlow: number, noisePosition: number, noise: number): number;
  queueStep(glottalFlow: number, noisePosition: number, noise: number): void;
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
export declare class Glottis {
  constructor(options?: { seed?: string | number; head?: HeadConfig });
  step(dt: number, control: Record<string, number>, noise: number): number;
}
export declare const DEFAULT_SOURCE: SourceName;
/** Controls of one VocalFolds step (pressure in Pa). */
export interface FoldControl {
  voicing: number;
  aspiration: number;
  closure: number;
  loudness: number;
  lungPressure: number;
  adduction: number;
  foldTension: number;
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
  step(dt: number, control: FoldControl, noise: number): number;
  reset(): void;
  /** Glottal flow after the last step (cm³/s). */
  readonly flow: number;
  /** Area between the folds after the last step (cm²). */
  area: number;
  intensity: number;
  noiseModulation: number;
}
export declare const FOLD_RATE: number;
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
  /** Boundary-layer loss coefficient (default 2e-5). */
  loss?: number;
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
  /** Radiated flow with a nose: lips plus nostrils (default) or either. */
  output?: 'both' | 'lips' | 'nostrils';
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
/** Band-limited (windowed-sinc) sample-rate conversion. */
export declare function resample(
  samples: ArrayLike<number>,
  fromRate: number,
  toRate: number,
  options?: { zeroCrossings?: number }
): Float32Array;

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
export type HeadPresetName = 'any' | 'male' | 'female' | 'child';
export interface HeadPreset {
  label: string;
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
  /** Median F1-F4 (Hz). */
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
  options?: { maxDuration?: number; analysisRate?: number; order?: number }
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
  /** Forward push of the lips (cm). */
  protrusion: number;
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
