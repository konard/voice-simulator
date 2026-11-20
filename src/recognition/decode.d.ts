import type { HeadConfig, LanguageCode } from '../index.js';
import type { FormantTrack } from './formants.js';
import type { FrameSet, FrontendOptions } from './frontend.js';
import type { ArticulationTrack } from './inversion.js';
import type { LandmarkResult, Nucleus } from './landmarks.js';
import type { PitchTrack } from './pitch.js';

export interface IpaDecodeOptions {
  /** Voice geometry. If omitted, the fast acoustic fit estimates the head. */
  voice?: HeadConfig;
  /** Use a text-only phone transition table for this language. */
  language?: LanguageCode;
  /** Search the union of these inventories. An empty list uses all IPA units. */
  languages?: readonly LanguageCode[];
  /** Highest permitted working rate, in Hz. */
  rate?: number;
  /** Seconds between analysis frames. Defaults to 0.005. */
  hop?: FrontendOptions['hop'];
  /** Maximum states per boundary. Defaults to 32. */
  beam?: number;
  /** Number of distinct readings to return, from 1 to 10. Defaults to 1. */
  nbest?: number;
}

export interface IpaStreamOptions extends IpaDecodeOptions {
  /** Maximum recording duration in seconds. Defaults to 30. */
  maxSeconds?: number;
}

export interface IpaSegment {
  ipa: string;
  kind: 'vowel' | 'consonant' | 'pause';
  start: number;
  end: number;
  /** Relative acoustic likelihood among alternatives for this span. */
  confidence: number;
  /** Set when analysis-by-synthesis replaces this segment. */
  revised?: true;
  long: boolean;
  cost: number;
}

export interface IpaSyllable {
  ipa: string;
  revised?: true;
  start: number;
  end: number;
  /** Half-open interval of segment indices. */
  segments: [first: number, afterLast: number];
}

export interface IpaReading {
  ipa: string;
  cost: number;
  confidence: number;
  segments: IpaSegment[];
}

export interface IpaLattice {
  times: Float64Array;
  /** The edge endpoints index times. */
  edges: { from: number; to: number; ipa: string; cost: number }[];
}

export interface IpaDecodeTracks {
  pitch: PitchTrack;
  formants: FormantTrack;
  landmarks: LandmarkResult;
  articulation: ArticulationTrack;
}

export interface IpaDecodeResult {
  /** Language used by the planner and syllabifier, if specified. */
  language?: LanguageCode;
  ipa: string;
  segments: IpaSegment[];
  syllables: IpaSyllable[];
  nbest: IpaReading[];
  lattice: IpaLattice;
  frames: FrameSet;
  tracks: IpaDecodeTracks;
  voice: HeadConfig;
}

export interface IpaStreamResult extends Omit<IpaDecodeResult, 'tracks'> {
  tracks: Omit<IpaDecodeTracks, 'formants' | 'articulation'> & {
    /** Available once the decoder establishes its initial voice or flushes. */
    formants: FormantTrack | null;
    articulation: ArticulationTrack | null;
  };
}

export interface IpaStreamUpdate {
  segments: Readonly<IpaSegment>[];
  nuclei: Nucleus[];
}

export interface IpaDecoder {
  push(chunk: ArrayLike<number>): IpaStreamUpdate;
  flush(): IpaStreamUpdate;
  /** Includes the current best continuation until flush. */
  result(): IpaStreamResult;
  reset(): void;
}

export function audioToIpa(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: IpaDecodeOptions
): IpaDecodeResult;

export function createIpaDecoder(
  sampleRate: number,
  options?: IpaStreamOptions
): IpaDecoder;
