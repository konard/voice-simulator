/**
 * Head and mouth proportions.
 *
 * A head configuration is the single source of truth for both the 3D model
 * and the acoustics: the low-poly mesh is generated from it, and the vocal
 * tract cross-sections that drive the wave simulation are read from that
 * mesh. Changing a proportion therefore changes the sound for physical
 * reasons (longer tract -> lower formants, bigger mouth -> brighter
 * radiation), not because of a lookup table.
 */

import { createRandom, randomNormal } from './random.js';
import { HEAD_PRESETS, HEAD_PRESET_NAMES } from './head-presets.js';

export { HEAD_PRESETS, HEAD_PRESET_NAMES };

/**
 * Parameter schema. `group` drives the editor layout, `unit` is shown in UIs.
 * Ranges are deliberately wider than typical adult anatomy so the editor can
 * explore child-like and exaggerated voices as well.
 */
export const HEAD_PARAMETERS = Object.freeze([
  {
    key: 'vocalTractLength',
    label: 'Vocal tract length',
    group: 'anatomy',
    unit: 'cm',
    min: 11,
    max: 20,
    step: 0.1,
    default: 16.5,
    description:
      'Glottis-to-lips length. Formants scale roughly with 1 / length.',
  },
  {
    key: 'pharynxRatio',
    label: 'Pharynx share',
    group: 'anatomy',
    unit: '',
    min: 0.35,
    max: 0.6,
    step: 0.01,
    default: 0.46,
    description: 'Fraction of the tract that is the vertical pharynx.',
  },
  {
    key: 'pharynxWidth',
    label: 'Pharynx width',
    group: 'anatomy',
    unit: 'x',
    min: 0.7,
    max: 1.35,
    step: 0.01,
    default: 1,
    description: 'Scales pharyngeal cross-sections.',
  },
  {
    key: 'oralWidth',
    label: 'Oral cavity width',
    group: 'anatomy',
    unit: 'x',
    min: 0.7,
    max: 1.35,
    step: 0.01,
    default: 1,
    description: 'Scales oral cavity cross-sections.',
  },
  {
    key: 'mouthWidth',
    label: 'Mouth width',
    group: 'mouth',
    unit: 'x',
    min: 0.7,
    max: 1.4,
    step: 0.01,
    default: 1,
    description: 'Lip corner distance; widens the lip opening.',
  },
  {
    key: 'lipThickness',
    label: 'Lip thickness',
    group: 'mouth',
    unit: 'x',
    min: 0.6,
    max: 1.6,
    step: 0.01,
    default: 1,
    description: 'Length of the lip tube section and visual lip volume.',
  },
  {
    key: 'jawRange',
    label: 'Jaw range',
    group: 'mouth',
    unit: 'x',
    min: 0.6,
    max: 1.4,
    step: 0.01,
    default: 1,
    description: 'How far the jaw opens for open vowels.',
  },
  {
    key: 'tongueSize',
    label: 'Tongue size',
    group: 'mouth',
    unit: 'x',
    min: 0.8,
    max: 1.25,
    step: 0.01,
    default: 1,
    description: 'Tongue volume; bigger tongues constrict more.',
  },
  {
    key: 'nasalSize',
    label: 'Nasal cavity size',
    group: 'anatomy',
    unit: 'x',
    min: 0.6,
    max: 1.4,
    step: 0.01,
    default: 1,
    description: 'Scales the nasal tract cross-sections.',
  },
  {
    key: 'headWidth',
    label: 'Head width',
    group: 'face',
    unit: 'x',
    min: 0.85,
    max: 1.2,
    step: 0.01,
    default: 1,
    description: 'Visual skull width (no acoustic effect).',
  },
  {
    key: 'headHeight',
    label: 'Head height',
    group: 'face',
    unit: 'x',
    min: 0.85,
    max: 1.2,
    step: 0.01,
    default: 1,
    description: 'Visual skull height (no acoustic effect).',
  },
  {
    key: 'noseLength',
    label: 'Nose length',
    group: 'face',
    unit: 'x',
    min: 0.7,
    max: 1.4,
    step: 0.01,
    default: 1,
    description: 'Outer nose size; also lengthens the nasal tract slightly.',
  },
  {
    key: 'pitch',
    label: 'Base pitch',
    group: 'voice',
    unit: 'Hz',
    min: 60,
    max: 320,
    step: 1,
    default: 120,
    description: 'Fundamental frequency of the vocal folds at rest.',
  },
  {
    key: 'pitchRange',
    label: 'Intonation range',
    group: 'voice',
    unit: 'st',
    min: 0.5,
    max: 8,
    step: 0.1,
    default: 3,
    description: 'Semitone range used for stress, tones and intonation.',
  },
  {
    key: 'tenseness',
    label: 'Vocal fold tenseness',
    group: 'voice',
    unit: '',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.6,
    description: 'Pressed (1) versus lax and breathy (0) glottal pulses.',
  },
  {
    key: 'breathiness',
    label: 'Breathiness',
    group: 'voice',
    unit: '',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.2,
    description: 'Amount of turbulent aspiration noise at the glottis.',
  },
  {
    key: 'vibrato',
    label: 'Vibrato depth',
    group: 'voice',
    unit: '',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.25,
    description:
      'Slow periodic pitch wobble that makes the voice less robotic.',
  },
  {
    key: 'speechRate',
    label: 'Speech rate',
    group: 'voice',
    unit: 'x',
    min: 0.5,
    max: 1.8,
    step: 0.01,
    default: 1,
    description: 'Multiplies phoneme durations (higher is faster).',
  },
  {
    key: 'jitter',
    label: 'Jitter',
    group: 'source',
    unit: '%',
    min: 0,
    max: 3,
    step: 0.05,
    default: 0.4,
    description: 'Random cycle-to-cycle variation of the glottal period.',
  },
  {
    key: 'shimmer',
    label: 'Shimmer',
    group: 'source',
    unit: '%',
    min: 0,
    max: 15,
    step: 0.1,
    default: 3,
    description:
      'Random cycle-to-cycle variation of the glottal pulse amplitude.',
  },
  {
    key: 'vibratoRate',
    label: 'Vibrato rate',
    group: 'source',
    unit: 'Hz',
    min: 3,
    max: 8,
    step: 0.1,
    default: 5.2,
    description: 'Frequency of the slow periodic pitch modulation.',
  },
  {
    key: 'aspirationLevel',
    label: 'Aspiration noise',
    group: 'source',
    unit: 'x',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
    description: 'Scales the turbulent noise generated at the glottis.',
  },
  {
    key: 'declination',
    label: 'Declination',
    group: 'prosody',
    unit: 'st',
    min: 0,
    max: 6,
    step: 0.1,
    default: 2,
    description: 'Pitch drop from the start to the end of a phrase.',
  },
  {
    key: 'accentStrength',
    label: 'Accent strength',
    group: 'prosody',
    unit: 'x',
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
    description: 'Scales the pitch rise on stressed syllables.',
  },
  {
    key: 'stressLengthening',
    label: 'Stress lengthening',
    group: 'prosody',
    unit: 'x',
    min: 1,
    max: 2,
    step: 0.01,
    default: 1.35,
    description: 'Duration factor of primary stressed vowels.',
  },
  {
    key: 'finalLengthening',
    label: 'Final lengthening',
    group: 'prosody',
    unit: 'x',
    min: 1,
    max: 2,
    step: 0.01,
    default: 1.4,
    description: 'Duration factor of vowels at the end of a phrase.',
  },
  {
    key: 'pauseLength',
    label: 'Pause length',
    group: 'prosody',
    unit: 'x',
    min: 0.3,
    max: 3,
    step: 0.01,
    default: 1,
    description: 'Scales pauses at spaces and punctuation.',
  },
  {
    key: 'articulationSpeed',
    label: 'Articulation speed',
    group: 'prosody',
    unit: 'x',
    min: 0.5,
    max: 2,
    step: 0.01,
    default: 1,
    description: 'How fast articulators move between targets (coarticulation).',
  },
  {
    key: 'wallLoss',
    label: 'Wall losses',
    group: 'acoustics',
    unit: 'x',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
    description:
      'Viscous and wall vibration losses of the tract and nose (formant bandwidths).',
  },
  {
    key: 'nasalCoupling',
    label: 'Nasal coupling',
    group: 'acoustics',
    unit: 'x',
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
    description:
      'Scales the velar port opening, so the nasality of nasals and nasal vowels.',
  },
  {
    key: 'fricationLevel',
    label: 'Frication level',
    group: 'acoustics',
    unit: 'x',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
    description:
      'Scales the turbulence noise at constrictions (fricatives and bursts).',
  },
  {
    key: 'outputGain',
    label: 'Output level',
    group: 'acoustics',
    unit: 'x',
    min: 0.25,
    max: 4,
    step: 0.01,
    default: 1,
    description:
      'Gain before the soft limiter; high values saturate like a loud voice.',
  },
]);

const PARAMETER_BY_KEY = new Map(
  HEAD_PARAMETERS.map((parameter) => [parameter.key, parameter])
);

/** Default (average adult) head configuration. */
export const DEFAULT_HEAD = Object.freeze(
  Object.fromEntries(
    HEAD_PARAMETERS.map((parameter) => [parameter.key, parameter.default])
  )
);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fill missing values with defaults and clamp everything into range.
 * Unknown keys are dropped so configs stay serializable and versionable.
 * @param {Partial<Record<string, number>>} [config]
 * @returns {Record<string, number>}
 */
export function normalizeHeadConfig(config = {}) {
  const result = {};
  for (const parameter of HEAD_PARAMETERS) {
    const raw = Number(config[parameter.key]);
    result[parameter.key] = Number.isFinite(raw)
      ? clamp(raw, parameter.min, parameter.max)
      : parameter.default;
  }
  return result;
}

/**
 * Describe a single parameter.
 * @param {string} key
 */
export function getHeadParameter(key) {
  return PARAMETER_BY_KEY.get(key);
}

function roundToStep(value, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/**
 * Clamp a head to the parameter ranges and round it to the parameter steps.
 * @param {Record<string, number>} config
 */
export function roundHead(config) {
  const normalized = normalizeHeadConfig(config);
  for (const parameter of HEAD_PARAMETERS) {
    normalized[parameter.key] = roundToStep(
      normalized[parameter.key],
      parameter.step
    );
  }
  return normalized;
}

function getPreset(name) {
  const preset = HEAD_PRESETS[name];
  if (!preset) {
    throw new Error(
      `Unknown head preset: ${name} (use ${HEAD_PRESET_NAMES.join(', ')})`
    );
  }
  return preset;
}

function presetHead(preset, size, jitter) {
  const config = {};
  for (const [key, [small, large, spread]] of Object.entries(preset.ranges)) {
    config[key] =
      key === 'pitch'
        ? small *
          Math.pow(large / small, size) *
          Math.pow(2, jitter(spread) / 12)
        : small + (large - small) * size + jitter(spread);
  }
  return roundHead(config);
}

/**
 * The head of a preset at a relative size, without random variation.
 * @param {string} name One of HEAD_PRESETS (male, female, child).
 * @param {number} [size] 0 = smallest of the group, 1 = largest (default 0.5, typical).
 * @returns {Record<string, number>}
 */
export function presetHeadConfig(name, size = 0.5) {
  return presetHead(getPreset(name), clamp(size, 0, 1), () => 0);
}

/**
 * Generate a plausible random head. Proportions are correlated through a
 * shared body-size factor (bigger heads get longer tracts and lower voices),
 * so random voices stay human-like.
 *
 * Without a preset (or with 'any') the head spans children to large men
 * and a seed always gives the same head. A preset (male, female, child) draws
 * from that group's ranges in HEAD_PRESETS; a seed gives the same relative
 * size and deviations in every preset.
 * @param {string|number} seed
 * @param {{preset?: string}} [options]
 * @returns {Record<string, number>}
 */
export function randomHeadConfig(seed, options = {}) {
  const random = createRandom(seed);
  const jitter = (spread) => spread * randomNormal(random);
  if (options.preset && options.preset !== 'any') {
    const preset = getPreset(options.preset);
    const size = clamp(0.5 + 0.25 * randomNormal(random), 0, 1);
    return presetHead(preset, size, jitter);
  }
  // 0 = small (child-like), 1 = large adult.
  const size = clamp(0.55 + 0.25 * randomNormal(random), 0, 1);
  return roundHead({
    vocalTractLength: 13 + 5 * size + jitter(0.5),
    pharynxRatio: 0.4 + 0.1 * size + jitter(0.02),
    pharynxWidth: 0.9 + 0.2 * size + jitter(0.06),
    oralWidth: 1 + jitter(0.08),
    mouthWidth: 1 + jitter(0.1),
    lipThickness: 1 + jitter(0.15),
    jawRange: 1 + jitter(0.1),
    tongueSize: 1 + jitter(0.05),
    nasalSize: 0.85 + 0.3 * size + jitter(0.08),
    headWidth: 0.95 + 0.1 * size + jitter(0.03),
    headHeight: 0.95 + 0.1 * size + jitter(0.03),
    noseLength: 1 + jitter(0.12),
    // Pitch follows size on a log scale: ~250 Hz small, ~100 Hz large.
    pitch: 250 * Math.pow(0.4, size) * Math.pow(2, jitter(2) / 12),
    pitchRange: 3 + jitter(0.8),
    tenseness: 0.6 + jitter(0.12),
    breathiness: 0.2 + jitter(0.08),
    vibrato: 0.25 + jitter(0.1),
    speechRate: 1 + jitter(0.06),
  });
}

/**
 * Serialize a head config into a compact URL query fragment.
 * @param {Record<string, number>} config
 * @returns {string}
 */
export function encodeHeadConfig(config) {
  const normalized = normalizeHeadConfig(config);
  return HEAD_PARAMETERS.map(
    (parameter) => `${parameter.key}=${normalized[parameter.key]}`
  ).join('&');
}

/**
 * Parse a fragment produced by encodeHeadConfig (unknown keys are ignored).
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function decodeHeadConfig(text) {
  const values = {};
  for (const pair of String(text ?? '')
    .replace(/^[?#]/, '')
    .split('&')) {
    const [key, value] = pair.split('=');
    if (PARAMETER_BY_KEY.has(key)) {
      values[key] = Number(value);
    }
  }
  return normalizeHeadConfig(values);
}
