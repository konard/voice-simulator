import type {
  HeadConfig,
  HeadPresetName,
  LanguageCode,
  SynthesizeOptions,
  SynthesisResult,
  VoiceFile,
} from '../index.js';
import type {
  RecognitionEvents,
  RecognitionOptions,
  RecognitionResult,
  RecognizedSegment,
  Recognizer,
} from '../recognition/recognizer.js';

export type ArticulationOffsets = Record<
  string,
  Partial<Record<'height' | 'backness' | 'rounding', number>>
>;
export type VoiceSessionState =
  | 'collecting'
  | 'fitting'
  | 'inverting'
  | 'refining'
  | 'stable';

export interface VoiceSessionOptions {
  sampleRate: number;
  languages?: readonly LanguageCode[];
  preset?: HeadPresetName | 'auto';
  voice?: VoiceFile | HeadConfig | string | null;
  minVoiced?: number;
  window?: number;
  tolerance?: number;
  stablePasses?: number;
  maxIterations?: number;
  halfLife?: number;
  driftFactor?: number;
  realtime?: boolean;
  backgroundShare?: number;
  level?: RecognitionOptions['level'];
  segments?: boolean;
  /** Include the recognizer's speech-mode classifications. Defaults to true. */
  includeModeLabels?: boolean;
  schedule?: (fn: () => void) => unknown;
}

export interface VoiceSessionPass {
  pass: number;
  state: VoiceSessionState;
  distance: number;
  changes: Record<string, number>;
  ipa: string;
}
export interface VoiceSessionRecognition extends Omit<
  RecognitionResult,
  'voice'
> {
  voice: VoiceFile | null;
}
export interface VoiceSessionEvents extends Omit<RecognitionEvents, 'final'> {
  state: {
    state: VoiceSessionState;
    previous: VoiceSessionState | null;
    reason:
      | 'start'
      | 'reset'
      | 'voiced'
      | 'fit-failed'
      | 'fitted'
      | 'phonemes'
      | 'converged'
      | 'drift'
      | 'speaker-change';
    time: number;
  };
  voice: {
    voice: VoiceFile;
    uncertainty: Record<string, number> | null;
    pass: number;
    distance: number;
    converged: boolean;
  };
  final: VoiceSessionRecognition;
}
export interface VoiceSession {
  readonly state: VoiceSessionState;
  readonly voice: VoiceFile | null;
  readonly uncertainty: Record<string, number> | null;
  readonly recognizer: Recognizer;
  readonly converged: boolean;
  readonly history: readonly VoiceSessionPass[];
  readonly load: number;
  /** Voiced audio measured for the current speaker. Resets on speaker change. */
  readonly voicedSeconds: number;
  backgroundShare: number;
  push(chunk: Float32Array): void;
  flush(): VoiceSessionRecognition;
  reset(): void;
  speak(text: string, synthesisOptions?: SynthesizeOptions): SynthesisResult;
  on<K extends keyof VoiceSessionEvents>(
    type: K,
    listener: (event: VoiceSessionEvents[K]) => void
  ): void;
  off<K extends keyof VoiceSessionEvents>(
    type: K,
    listener: (event: VoiceSessionEvents[K]) => void
  ): void;
}
export interface CopyVoiceResult {
  voice: VoiceFile | null;
  uncertainty: Record<string, number> | null;
  recognition: VoiceSessionRecognition & { segments: RecognizedSegment[] };
  passes: number;
  converged: boolean;
  history: readonly VoiceSessionPass[];
}

export function createVoiceSession(options: VoiceSessionOptions): VoiceSession;
export function copyVoice(
  samples: ArrayLike<number>,
  sampleRate: number,
  options?: Omit<
    VoiceSessionOptions,
    'sampleRate' | 'window' | 'maxIterations' | 'realtime' | 'segments'
  >
): CopyVoiceResult;
