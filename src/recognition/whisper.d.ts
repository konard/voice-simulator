import type { FrameSet } from './frontend.js';
import type { PitchTrack } from './pitch.js';

export interface WhisperSpan {
  start: number;
  end: number;
  confidence: number;
}

export interface WhisperMode extends WhisperSpan {
  from: number;
  to: number;
  phonation: { whisper: 1 };
  notation: 'W';
}

import type { ToneCosts } from './prosody.js';

export type WhisperToneCosts = ToneCosts;

/** Find whisper spans using frame periodicity to check weak 8 kHz edges. */
export function findWhisper(
  samples: ArrayLike<number>,
  sampleRate: number,
  frames: FrameSet,
  pitch: PitchTrack
): WhisperSpan[];

export function whisperTones(
  frames: FrameSet,
  syllable: {
    start: number;
    vowelStart?: number;
    end: number;
    meanDuration?: number;
  }
): WhisperToneCosts;
