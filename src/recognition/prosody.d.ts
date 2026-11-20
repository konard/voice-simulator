import type { HeadConfig, LanguageCode } from '../index.js';
import type { FrameSet } from './frontend.js';
import type {
  RecognitionSound,
  IpaToTextResult,
  RecognitionWord,
} from './ipa-to-text.js';
import type { PitchTrack } from './pitch.js';
import type { WhisperSpan, WhisperMode } from './whisper.js';

export type ToneCosts = Record<'˥' | '˧˥' | '˨˩˦' | '˨˩' | '˥˩' | '', number>;

export interface ProsodyOptions {
  /** Optional speaker pitch and range reference. */
  voice?: HeadConfig | { head: HeadConfig } | null;
  /** Language hint for grouping contiguous vowels and for unlabelled words. */
  language?: LanguageCode;
  /** Override automatic detection with known whisper spans in seconds. */
  whisperSpans?: readonly WhisperSpan[];
  /** Reuse the frames and pitch track from the same front-end analysis. */
  frames?: FrameSet;
  pitch?: PitchTrack;
}

export interface MeasuredProsody<
  T extends RecognitionSound = RecognitionSound,
> {
  sounds: (T & { tones?: ToneCosts | null; prominence?: number })[];
  pitch: PitchTrack & {
    /** Semitones relative to median, or null in unvoiced and rejected frames. */
    semitones: (number | null)[];
    /** Mean square amplitude per pitch hop. */
    energy: Float64Array;
  };
  /** The reference in Hz. Null when no reference or voiced pitch is available. */
  median: number | null;
  /** 5th to 95th percentile span in semitones, floored at four. */
  range: number;
  whisperSpans?: readonly WhisperSpan[];
}

interface ProsodySpan {
  start: number;
  end: number;
  from: number;
  to: number;
  confidence: number;
}

export type ProsodyModeSpan = ProsodySpan &
  (
    | { emphasis: 1; notation: 'ˈˈ' }
    | {
        tune: 'yesno' | 'wh' | 'exclamation' | 'continuation';
        notation: '?' | '↗ ?' | '↘ ?' | '!' | ',';
      }
  );

export interface ProsodyResult extends Omit<IpaToTextResult, 'words'> {
  words: (Omit<RecognitionWord, 'language'> & {
    language?: LanguageCode;
    lang?: LanguageCode;
  })[];
}

export declare function measureProsody<T extends RecognitionSound>(
  samples: ArrayLike<number>,
  sampleRate: number,
  sounds: readonly T[],
  options?: ProsodyOptions
): MeasuredProsody<T>;

export declare function markProsody<
  T extends ProsodyResult & { modes?: readonly object[] },
>(
  result: T,
  measured: MeasuredProsody,
  options?: ProsodyOptions
): Omit<T, 'modes'> & {
  modes: (ProsodyModeSpan | WhisperMode | NonNullable<T['modes']>[number])[];
};
