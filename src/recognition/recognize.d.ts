import type {
  IpaDecodeOptions,
  IpaStreamOptions,
  IpaDecodeResult,
  IpaDecoder,
  IpaStreamResult,
} from './decode.js';
import type { IpaToTextResult } from './ipa-to-text.js';
import type { WhisperMode } from './whisper.js';

export interface AudioRecognitionResult extends IpaToTextResult {
  modes: WhisperMode[];
  audio: IpaDecodeResult;
}

export function recognize(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: IpaDecodeOptions
): AudioRecognitionResult;

export function createRecognizer(
  sampleRate: number,
  options?: IpaStreamOptions
): Omit<IpaDecoder, 'result'> & {
  result(): Omit<AudioRecognitionResult, 'audio'> & { audio: IpaStreamResult };
};
