/**
 * Head and mouth proportions.
 *
 * A head configuration is the single source of truth for both the 3D model
 * and the acoustics: the low-poly mesh is generated from it, and the vocal
 * tract cross-sections that drive the wave simulation are read from that
 * mesh. Changing a proportion therefore changes the sound for physical
 * reasons (longer tract -> lower formants, bigger mouth -> brighter
 * radiation), not because of a lookup table.
 *
 * The parameters live in one table per group (src/parameters/); a head is
 * still one flat object `{key: value}`.
 */

import { createRandom, randomNormal } from './random.js';
import { HEAD_PRESETS, HEAD_PRESET_NAMES } from './head-presets.js';
import { ANATOMY_PARAMETERS } from './parameters/anatomy.js';
import { FOLDS_PARAMETERS } from './parameters/folds.js';
import { BREATHING_PARAMETERS } from './parameters/breathing.js';
import { ARTICULATION_PARAMETERS } from './parameters/articulation.js';
import { EXPRESSION_PARAMETERS } from './parameters/expression.js';
import { MICROPHONE_PARAMETERS } from './parameters/microphone.js';

export { HEAD_PRESETS, HEAD_PRESET_NAMES };

const GROUP_PARAMETERS = {
  anatomy: ANATOMY_PARAMETERS,
  folds: FOLDS_PARAMETERS,
  breathing: BREATHING_PARAMETERS,
  articulation: ARTICULATION_PARAMETERS,
  expression: EXPRESSION_PARAMETERS,
  microphone: MICROPHONE_PARAMETERS,
};

/**
 * The parameter groups in the order of the editor and of voice files:
 * anatomy, folds, breathing, articulation, expression, microphone.
 */
export const HEAD_GROUPS = Object.freeze(Object.keys(GROUP_PARAMETERS));

/**
 * The parameters of the first versions: the editor shows them by default,
 * the others (`advanced: true`) behind "Show all parameters".
 */
const BASIC_PARAMETERS = new Set([
  'vocalTractLength',
  'pharynxRatio',
  'pharynxWidth',
  'oralWidth',
  'nasalSize',
  'mouthWidth',
  'lipThickness',
  'jawRange',
  'tongueSize',
  'headWidth',
  'headHeight',
  'noseLength',
  'pitch',
  'pitchRange',
  'tenseness',
  'breathiness',
  'vibrato',
  'speechRate',
  'jitter',
  'shimmer',
  'vibratoRate',
  'aspirationLevel',
  'glottalChink',
  'declination',
  'accentStrength',
  'stressLengthening',
  'finalLengthening',
  'pauseLength',
  'articulationSpeed',
  'wallLoss',
  'nasalCoupling',
  'fricationLevel',
  'outputGain',
]);

/**
 * Parameter schema: `{key, label, group, unit, min, max, step, default,
 * description, source, effect, advanced}`. `group` (one of HEAD_GROUPS)
 * drives the editor layout and the voice files, `unit` is shown in UIs
 * ('1' for a plain number, 'x' for a factor), `source` cites where the
 * default and the range come from (a paper or `fitted: <experiment>`) and
 * `effect` ({measure, sign}) says which measure of the sound goes up
 * (sign 1) or down (-1) from `min` to `max` (see docs/VOICE-PARAMETERS.md).
 * Ranges are deliberately wider than typical adult anatomy so the editor
 * can explore child-like and exaggerated voices as well.
 */
export const HEAD_PARAMETERS = Object.freeze(
  HEAD_GROUPS.flatMap((group) =>
    GROUP_PARAMETERS[group].map((entry) =>
      Object.freeze({
        key: entry.key,
        label: entry.label,
        group,
        unit: entry.unit,
        min: entry.min,
        max: entry.max,
        step: entry.step,
        default: entry.default,
        description: entry.description,
        source: entry.source,
        effect: Object.freeze({ ...entry.effect }),
        advanced: !BASIC_PARAMETERS.has(entry.key),
      })
    )
  )
);

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
  const result = { ...DEFAULT_HEAD };
  for (const parameter of HEAD_PARAMETERS) {
    const raw = Number(config[parameter.key]);
    if (Number.isFinite(raw)) {
      result[parameter.key] = clamp(raw, parameter.min, parameter.max);
    }
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
    // Drawn last so that the values above stay those of earlier versions.
    foldLength: 0.7 + 0.8 * size + jitter(0.05),
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
