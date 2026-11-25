/**
 * Speech and recognition settings of the page and the engine options they
 * stand for (issue 170). No React here, so the tests can import it.
 */
import { addNoise } from '../../../../src/audio/noise.js';

/** Speech generation settings the app does not show by default (issue 170). */
export const DEFAULT_VOICE_SETTINGS = {
  accentLevel: 1,
  weakForms: true,
  breaths: false,
  source: 'lf',
  interaction: false,
  subglottal: true,
  headroom: 'auto',
};

/** The request fields of VoiceEngine.speak for the settings. */
export function voiceOptions(settings) {
  const folds = settings.source === 'folds';
  return {
    weakForms: settings.weakForms,
    breaths: settings.breaths,
    source: settings.source,
    interaction: folds ? settings.interaction : undefined,
    subglottal: folds && settings.interaction ? settings.subglottal : undefined,
    headroom: settings.headroom === 'auto' ? undefined : settings.headroom,
  };
}

/** Recognition settings the app does not show by default (issue 170). */
export const DEFAULT_RECOGNITION_SETTINGS = {
  level: 'auto',
  decoder: 'words',
  oov: true,
  whisper: true,
  modes: true,
  // 'default': 0.1 s of voiced speech per live phrase, no gate for files.
  minVoiced: 'default',
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  noise: 'none',
  snr: 10,
};

export const MICROPHONE_SETTINGS = [
  'echoCancellation',
  'noiseSuppression',
  'autoGainControl',
];

/** The createRecognizer options of the settings, sent to the worker. */
export function recognitionOptions(settings) {
  return {
    level: settings.level,
    decoder: settings.decoder,
    oov: settings.decoder === 'words' ? settings.oov : undefined,
    whisper: settings.whisper ? undefined : false,
    modes: settings.modes,
    minVoiced:
      settings.minVoiced === 'default' ? undefined : settings.minVoiced,
  };
}

/** The getUserMedia audio constraints of the settings. */
export function microphoneConstraints(settings) {
  return Object.fromEntries(
    MICROPHONE_SETTINGS.map((key) => [key, settings[key]])
  );
}

/**
 * Decoded samples with the chosen noise laid over them at the chosen
 * signal-to-noise ratio, or the input itself without noise.
 */
export function noisyInput(input, settings) {
  if (settings.noise === 'none') {
    return input;
  }
  return {
    ...input,
    samples: addNoise(input.samples, input.sampleRate, {
      type: settings.noise,
      snr: settings.snr,
      seed: 1,
    }),
  };
}
