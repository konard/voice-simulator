/**
 * Voice matching: find the head whose simulated voice is closest to a
 * recording, so the simulator can copy that voice.
 *
 * 1. Measure the recording (analyzeVoice): f0 level and range, formant
 *    spacing of F1 to F3 (vocal tract length), H1-H2, harmonics-to-noise ratio and
 *    syllable rate.
 * 2. Start from the closest preset person (male, female or child at the
 *    best relative size) with the measured pitch and rate.
 * 3. Analysis by synthesis: render a calibration sentence with the current
 *    head, measure it with the same analysis and move each parameter by a
 *    secant step towards the recording's feature. The number of renders is
 *    bounded and every render uses a fixed seed, so a recording always gives
 *    the same head.
 */

import { formantSpacing } from './voice-features.js';
import { SPEED_OF_SOUND } from '../acoustics/constants.js';
import { fitVoiceSteps } from './voice-fit.js';
import { MATCH_TEXT } from './voice-fit-calibration.js';
import { BREATHINESS_RD, BREATHINESS_REFERENCE } from '../acoustics/glottis.js';
export { MATCH_TEXT };
const semitones = (value) => 12 * Math.log2(value);

/**
 * Tract length (cm) from the spacing of F1 to F3 of the median formant
 * tracks, 0 when one of them is missing. F4 lies near the top of the
 * analysis band and moves by up to 3 % from one head to the next, so the
 * length read with it (analyzeVoice's vocalTractLength) stays flat over
 * 1.5 cm and reverses: the female preset reads 15.83 at 14.8 cm and 15.97
 * at 16.1 cm. Without F4 the reading rises by 0.8 per cm and scatters by
 * 0.23 cm of length over the adult people, against 0.40 cm with F4
 * (experiments/issue-40-length-feature.txt).
 * @param {{formants?: number[]}} features
 */
export function lowerFormantLength(features) {
  const formants = (features.formants ?? []).slice(0, 3);
  return formants.length === 3 && formants.every((value) => value > 0)
    ? SPEED_OF_SOUND / (2 * formantSpacing(formants))
    : 0;
}

/**
 * Change of tenseness that keeps the LF pulse of a head's breathiness the
 * same as at the reference breathiness (lfParameters: Rd falls by 3 per
 * unit of tenseness and rises by BREATHINESS_RD per unit of breathiness).
 */
function breathinessShift(head) {
  return (BREATHINESS_RD / 3) * (head.breathiness - BREATHINESS_REFERENCE);
}

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
    read: lowerFormantLength,
    slope: 0.8,
    maxStep: 2.5,
    scale: 0.5,
  },
  {
    // HNR falls by 16 to 20 dB per unit of breathiness in the presets
    // (experiments/issue-32-voice-sensitivity.txt), little below 0.25 where
    // the breath noise is under the jitter floor and 25 to 30 dB per unit
    // above it. The wide step reaches 0.8 from a preset in three steps
    // (experiments/issue-32-recover-breathiness.txt).
    key: 'breathiness',
    feature: 'hnr',
    slope: -18,
    // Faster speech reads a noisier voice: HNR falls by 4 to 9 dB per unit
    // of log speech rate at a fixed breathiness, and H1-H2 does not change
    // (experiments/issue-35-rate-hnr.txt). The step subtracts the change
    // that the speech-rate step brings, so that a first render at a wrong
    // rate is not read as a wrong breathiness.
    rateSlope: -7,
    maxStep: 0.25,
    scale: 3,
  },
  {
    // Breathiness lengthens the open phase too, so tenseness is matched as
    // the tenseness of the same pulse at the reference breathiness; this
    // entry follows breathiness, whose new value fromX reads.
    key: 'tenseness',
    feature: 'h1h2',
    toX: (value, head) => value - breathinessShift(head),
    fromX: (value, head) => value + breathinessShift(head),
    slope: -37,
    maxStep: 0.15,
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
  // d log(syllable rate) / d log(speechRate) of two sentences and both
  // presets at speechRate 0.7 to 1.8 under the duration rules of issue 39
  // (experiments/issue-39-rate-slopes.txt). The peak count is noisy: 0.11
  // between 0.85 and 1.25 only.
  slope: 0.28,
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
  // -d log(speaking time) / d log(speechRate), same renders as above
  // (experiments/issue-39-rate-slopes.txt): the minimum of every sound
  // shrinks with speechRate ** 0.5 only, so the time falls slower than
  // 1 / speechRate.
  slope: 0.75,
  maxStep: 0.4,
  scale: 0.05,
};

function controlsFor(options) {
  return [...CONTROLS, options.transcript ? SPEAKING_TIME : SYLLABLE_RATE];
}

const identity = (value) => value;

function featureY(control, features) {
  const value = control.read
    ? control.read(features)
    : features[control.feature];
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

/** Compatibility wrapper: a legacy round is a budget of ten renders. */
export function* matchVoiceSteps(samples, sampleRate, options = {}) {
  const total =
    Math.max(
      1,
      Math.min(12, Math.round(options.iterations ?? options.rounds ?? 4))
    ) * 10;
  const steps = fitVoiceSteps(samples, sampleRate, {
    ...options,
    maxRenders: total,
  });
  let next = steps.next();
  while (!next.done) {
    yield { ...next.value, total };
    next = steps.next();
  }
  const { head, preset, features, rendered, distance } = next.value;
  return { head, preset, features, rendered, distance };
}
export function matchVoice(samples, sampleRate, options = {}) {
  const steps = matchVoiceSteps(samples, sampleRate, options);
  let next = steps.next();
  while (!next.done) {
    next = steps.next();
  }
  return next.value;
}
