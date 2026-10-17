/**
 * Voice matching: find the head whose simulated voice is closest to a
 * recording, so the simulator can copy that voice.
 *
 * 1. Measure the recording (analyzeVoice): f0 level and range, formant
 *    spacing (vocal tract length), H1-H2, harmonics-to-noise ratio and
 *    syllable rate.
 * 2. Start from the closest preset person (male, female or child at the
 *    best relative size) with the measured pitch and rate.
 * 3. Analysis by synthesis: render a calibration sentence with the current
 *    head, measure it with the same analysis and move each parameter by a
 *    secant step towards the recording's feature. The number of renders is
 *    bounded and every render uses a fixed seed, so a recording always gives
 *    the same head.
 */

import { analyzeVoice } from './voice-features.js';
import {
  HEAD_PRESETS,
  getHeadParameter,
  presetHeadConfig,
  roundHead,
} from '../head-config.js';
import { synthesize } from '../synthesize.js';

/** Sentence rendered to compare the simulator with the recording. */
export const MATCH_TEXT =
  'Please call Stella and ask her to bring these things with her.';

const MATCH_PRESETS = ['male', 'female', 'child'];
const SIZES = 11;
const semitones = (value) => 12 * Math.log2(value);

/**
 * Each control moves one head parameter to match one feature. `slope` is
 * the measured change of the feature per unit of the parameter (both in the
 * transformed units of `toX` and `toY`, see
 * experiments/issue-5-voice-sensitivity.mjs); `scale` is the feature
 * difference that counts as one unit of distance.
 */
const CONTROLS = [
  {
    key: 'pitch',
    feature: 'f0',
    toX: semitones,
    fromX: (value) => 2 ** (value / 12),
    toY: semitones,
    slope: 1,
    maxStep: 6,
    scale: 1,
  },
  {
    key: 'pitchRange',
    feature: 'f0Range',
    slope: 1.1,
    maxStep: 2,
    scale: 1.5,
  },
  {
    key: 'vocalTractLength',
    feature: 'vocalTractLength',
    slope: 0.55,
    maxStep: 2.5,
    scale: 0.5,
  },
  {
    key: 'tenseness',
    feature: 'h1h2',
    slope: -37,
    maxStep: 0.15,
    scale: 3,
  },
  {
    key: 'breathiness',
    feature: 'hnr',
    slope: -2,
    maxStep: 0.1,
    scale: 3,
  },
];

/** Speech rate from the syllable rate, when the words are unknown. */
const SYLLABLE_RATE = {
  key: 'speechRate',
  feature: 'syllableRate',
  toX: Math.log,
  fromX: Math.exp,
  toY: Math.log,
  slope: 0.5,
  maxStep: 0.15,
  scale: 0.1,
};

/** Speech rate from the speaking time, when the render says the same words. */
const SPEAKING_TIME = {
  key: 'speechRate',
  feature: 'activeDuration',
  toX: Math.log,
  fromX: Math.exp,
  toY: (value) => -Math.log(value),
  slope: 0.9,
  maxStep: 0.4,
  scale: 0.05,
};

function controlsFor(options) {
  return [...CONTROLS, options.transcript ? SPEAKING_TIME : SYLLABLE_RATE];
}

const identity = (value) => value;

function featureY(control, features) {
  const value = features[control.feature];
  return Number.isFinite(value) && value !== 0
    ? (control.toY ?? identity)(value)
    : null;
}

/**
 * Distance between two feature sets: the root mean square of the feature
 * differences, each divided by its control's scale (0 = identical).
 * @param {object} target
 * @param {object} candidate
 * @param {{transcript?: string}} [options] With a transcript both say the
 *   same words, so speaking time replaces the syllable rate.
 */
export function featureDistance(target, candidate, options = {}) {
  let sum = 0;
  let count = 0;
  for (const control of controlsFor(options)) {
    const wanted = featureY(control, target);
    const got = featureY(control, candidate);
    if (wanted !== null && got !== null) {
      sum += ((wanted - got) / control.scale) ** 2;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : Infinity;
}

/**
 * Tract length implied by a measured formant spacing in this simulator:
 * the LPC estimate is compressed towards 14.4 cm with a slope of about 0.55.
 */
function lengthGuess(measured) {
  return 15.5 + (measured - 14.4) / 0.55;
}

/**
 * Closest preset person (preset and relative size) to a pitch and tract
 * length; the person supplies every parameter that is not matched directly
 * (pharynx and mouth proportions, nose, source details).
 * @param {number} pitch Hz
 * @param {number} length cm
 * @param {string} [preset] Restrict the search to one preset.
 */
function closestPerson(pitch, length, preset) {
  const names = preset && preset !== 'any' ? [preset] : MATCH_PRESETS;
  let best = null;
  for (const name of names) {
    for (let index = 0; index < SIZES; index++) {
      const head = presetHeadConfig(name, index / (SIZES - 1));
      const cost =
        ((semitones(pitch) - semitones(head.pitch)) / 3) ** 2 +
        (length - head.vocalTractLength) ** 2;
      if (!best || cost < best.cost) {
        best = { cost, name, head };
      }
    }
  }
  return best;
}

/**
 * Give a head the proportions of a person of the same preset at the size
 * that fits its tract length. The preset changes only when the tract is
 * more than 1 cm outside the preset's range, so the proportions do not
 * flip between presets from one render to the next.
 */
function withPerson(head, preset, controls) {
  const [small, large] = HEAD_PRESETS[preset].ranges.vocalTractLength;
  const length = head.vocalTractLength;
  const keep = length > small - 1 && length < large + 1;
  const person = closestPerson(head.pitch, length, keep ? preset : undefined);
  const next = { ...person.head };
  for (const control of controls) {
    next[control.key] = head[control.key];
  }
  return { preset: person.name, head: roundHead(next) };
}

function initialHead(features, preset, controls) {
  const head = {
    pitch: features.f0 / 1.03,
    vocalTractLength: lengthGuess(features.vocalTractLength || 15.5),
    pitchRange: features.f0Range > 0 ? (features.f0Range - 2.4) / 1.1 : 3,
    tenseness: 0.6,
    breathiness: 0.2,
    speechRate: features.syllableRate > 0 ? features.syllableRate / 4.5 : 1,
  };
  const person = closestPerson(head.pitch, head.vocalTractLength, preset);
  head.tenseness = person.head.tenseness;
  head.breathiness = person.head.breathiness;
  return withPerson(head, person.name, controls);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Move every parameter one secant step towards the target features. The
 * slope comes from the last two renders when their parameter values differ,
 * and from the control's calibrated slope otherwise.
 */
function updateHead(head, target, history, controls) {
  const next = { ...head };
  for (const control of controls) {
    const wanted = featureY(control, target);
    const points = history.get(control.key);
    const last = points.at(-1);
    if (wanted === null || last.y === null) {
      continue;
    }
    let slope = control.slope;
    const previous = points.at(-2);
    if (previous && previous.y !== null && previous.x !== last.x) {
      const measured = (last.y - previous.y) / (last.x - previous.x);
      const ratio = measured / control.slope;
      if (ratio > 0.25 && ratio < 4) {
        slope = measured;
      }
    }
    const step = clamp(
      (wanted - last.y) / slope,
      -control.maxStep,
      control.maxStep
    );
    const parameter = getHeadParameter(control.key);
    next[control.key] = clamp(
      (control.fromX ?? identity)(last.x + step),
      parameter.min,
      parameter.max
    );
  }
  return roundHead(next);
}

function renderFeatures(head, options) {
  const { samples, sampleRate } = synthesize(options.transcript || MATCH_TEXT, {
    head,
    lang: options.lang ?? 'en',
    sampleRate: 16000,
    solver: 'waveguide',
    seed: 1,
  });
  return analyzeVoice(samples, sampleRate);
}

/**
 * Voice matching as a generator: every render is one step, so a user
 * interface can yield to the event loop between steps. Yields
 * `{step, total, head, distance}`; returns the same result as matchVoice.
 * @param {ArrayLike<number>} samples Mono recording.
 * @param {number} sampleRate
 * @param {{preset?: string, iterations?: number, transcript?: string, lang?: string, maxDuration?: number}} [options]
 *   transcript is what the recording says (in `lang`, default en); the
 *   renders then say the same words, which makes pitch and rate exact.
 */
export function* matchVoiceSteps(samples, sampleRate, options = {}) {
  const features = analyzeVoice(samples, sampleRate, options);
  if (!(features.f0 > 0) || features.voicedDuration < 0.2) {
    throw new Error('No voiced speech found in the recording');
  }
  const total = clamp(Math.round(options.iterations ?? 4), 1, 12);
  const controls = controlsFor(options);
  let { head, preset } = initialHead(features, options.preset, controls);
  const history = new Map(controls.map((control) => [control.key, []]));
  let best = null;
  yield { step: 0, total, head, distance: Infinity };
  for (let step = 1; step <= total; step++) {
    const rendered = renderFeatures(head, options);
    const distance = featureDistance(features, rendered, options);
    if (!best || distance < best.distance) {
      best = { head, preset, rendered, distance };
    }
    for (const control of controls) {
      history.get(control.key).push({
        x: (control.toX ?? identity)(head[control.key]),
        y: featureY(control, rendered),
      });
    }
    yield { step, total, head, distance };
    if (step < total) {
      ({ head, preset } = withPerson(
        updateHead(head, features, history, controls),
        preset,
        controls
      ));
    }
  }
  return {
    head: best.head,
    preset: best.preset,
    features,
    rendered: best.rendered,
    distance: best.distance,
  };
}

/**
 * Find the head whose simulated voice is closest to a recording.
 * @param {ArrayLike<number>} samples Mono recording.
 * @param {number} sampleRate
 * @param {Parameters<typeof matchVoiceSteps>[2]} [options] preset restricts
 *   the starting person; iterations (default 4) bounds the renders.
 * @returns {{head: Record<string, number>, preset: string, features: object, rendered: object, distance: number}}
 */
export function matchVoice(samples, sampleRate, options = {}) {
  const steps = matchVoiceSteps(samples, sampleRate, options);
  let result = steps.next();
  while (!result.done) {
    result = steps.next();
  }
  return result.value;
}
