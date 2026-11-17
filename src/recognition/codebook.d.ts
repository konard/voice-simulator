import type { HeadConfig } from '../index.js';
import type { FrameSet } from './frontend.js';
export interface CodebookChannel {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}
export declare const CODEBOOK_CHANNELS: readonly CodebookChannel[];
/** 24 mel-spaced frequencies for a 16.5 cm tract, in Hz. */
export declare const GRID: Float64Array;
export interface CodebookOptions {
  /** Rows, default 20000, maximum 100000. Small tables may omit seeds. */
  size?: number;
  /** Finite integer, default 1. */
  seed?: number;
  /** Synchronous binary cache; default an in-memory Map. */
  cache?: {
    get(id: number): Uint8Array | undefined;
    set(id: number, bytes: Uint8Array): unknown;
  };
}
export interface CodebookStats {
  rows: Record<
    | 'neutral'
    | 'vowel'
    | 'nasalVowel'
    | 'consonant'
    | 'mixture'
    | 'perturbed'
    | 'randomVowel',
    number
  >;
  nasalRows: number;
  /** Fraction with another row's four formants within 3% and a channel >25% away. */
  nonUniqueShare: number;
  /** Wall time of a fresh build; zero after parsing or a cache hit. Not serialized. */
  buildMilliseconds: number;
}
export interface CodebookQuery {
  /** Row numbers, -1 when fewer than k candidates are available. */
  index: Int32Array;
  /** Mean squared envelope difference in dB²; Infinity for absent results. */
  cost: Float64Array | Float32Array;
}
export interface Codebook {
  version: number;
  id: number;
  size: number;
  /** Requested tract length / 16.5 cm. */
  lengthScale: number;
  /** Build length rounded to 0.5 cm; tables are cached per length. */
  referenceLength: number;
  channels: readonly CodebookChannel[];
  articulation: Uint8Array;
  formants: Int16Array;
  envelope: Uint8Array;
  key: Float32Array;
  phone: Uint16Array;
  /** Preorder nodes [row, dimension, leftNode, rightNode], -1 for absent child. */
  tree: Int32Array;
  stats: CodebookStats;
  /** 24 normalized dB levels; NaN marks absent bands. k defaults to 16,
   * at most 64. Reuses internal scratch; queries are synchronous. */
  query(
    envelope: ArrayLike<number>,
    k: number | undefined,
    out: CodebookQuery
  ): CodebookQuery;
}
export interface CodebookFrame {
  envelope: Float64Array | Float32Array;
  key: Float64Array | Float32Array;
}
export declare function buildCodebook(
  head?: Partial<HeadConfig>,
  options?: CodebookOptions
): Codebook;
export declare function serializeCodebook(codebook: Codebook): Uint8Array;
export declare function parseCodebook(bytes: Uint8Array): Codebook;
/** Reuses out; high bands above 0.95 Nyquist stay NaN. */
export declare function frameEnvelope(
  frames: FrameSet,
  t: number,
  codebook: Codebook,
  out: CodebookFrame
): CodebookFrame;
/** Oral tube response in dB, with tubeTransfer's default loss and radiation. */
export declare function tractResponse(
  areas: ArrayLike<number>,
  length: number,
  frequencies: ArrayLike<number>,
  out: Float64Array | Float32Array
): Float64Array | Float32Array;
