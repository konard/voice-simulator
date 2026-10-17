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
}

export interface Transcription {
  lang: string;
  ipa: string;
  words: Word[];
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
  renderOptions: RenderOptions;
};
export declare function getAudioTier(
  tier: string | number | undefined | null
): AudioTier | null;

// Text to IPA
export declare const LANGUAGES: Readonly<Record<LanguageCode, Language>>;
export declare function textToIpa(
  text: string,
  options?: { lang?: 'auto' | LanguageCode }
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
  });
  /** Distance of the receiver from the lips (cm), with a microphone. */
  readonly microphoneDistance?: number;
  /** True when the grid contains the enclosure walls. */
  readonly simulatesEnclosure: boolean;
  stepDuration(): number;
  setShape(
    areas: ArrayLike<number>,
    velumArea: number,
    velumIndex?: number,
    teeth?: { gap: number } | null
  ): void;
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
  options?: {
    dx?: number;
    radiationRadius?: number;
    enclosure?: EnclosureOptions;
  }
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
  /** `false` leaves out the piriform fossae (waveguide). */
  piriform?: boolean;
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
}): { dx: number; radiationRadius?: number; enclosure?: ResolvedEnclosure };
/** Listening chain after a solver, or null for the default output. */
export declare function createListener(options: {
  microphone?: MicrophoneOptions;
  room?: RoomPreset | RoomSpec | null;
  enclosure?: EnclosureBounds | null;
  solver: Solver;
  sampleRate: number;
}): { process(value: number): number; tail: number } | null;
