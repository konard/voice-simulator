/**
 * Stage A readings that depend on the words, from the synthesizer's own plan
 * of the transcript (prepareUtterance renders no audio). Unlicense, issue 63.
 */
import { prepareUtterance } from '../synthesize.js';
import { HEAD_PARAMETERS } from '../head-config.js';
import { SPEECH_TIME, PLANNED_RANGE_RATIO } from './voice-fit-calibration.js';

function plan(text, head, options) {
  return prepareUtterance(text, {
    head,
    lang: options.language ?? options.lang,
    ipa: options.ipa,
    seed: 1,
  }).plan;
}

/**
 * Seconds from the first to the last sound of the plan of `text` at
 * `speechRate` on the default head (leading and trailing pauses excluded).
 */
export function plannedSpeechTime(text, speechRate, options = {}) {
  const segments = plan(text, { speechRate }, options).segments;
  let first = 0,
    last = segments.length - 1;
  while (first <= last && segments[first].kind === 'pause') {
    first++;
  }
  while (last >= first && segments[last].kind === 'pause') {
    last--;
  }
  return first > last ? 0 : segments[last].end - segments[first].start;
}

/**
 * 5th to 95th percentile range (semitones) of the planned f0 over voiced
 * frames of `text` at `pitchRange` on the default head; 0 without voicing.
 */
export function plannedPitchRange(text, pitchRange, options = {}) {
  const p = plan(text, { pitchRange }, options),
    { f0, voicing } = p.channels,
    semitones = [];
  for (let i = 0; i < p.frameCount; i++) {
    if (voicing[i] > 0.5 && f0[i] > 0) {
      semitones.push(12 * Math.log2(f0[i]));
    }
  }
  if (semitones.length < 2) {
    return 0;
  }
  semitones.sort((a, b) => a - b);
  const at = (q) =>
    semitones[Math.min(semitones.length - 1, Math.floor(q * semitones.length))];
  return at(0.95) - at(0.05);
}

/**
 * The value of `key` in its parameter range at which the increasing
 * `predict` equals `measured`: bisection in log value, null when the plan is
 * empty.
 */
function solve(key, predict, measured, steps) {
  const { min, max } = HEAD_PARAMETERS.find((p) => p.key === key);
  if (!(measured > 0) || !(predict(1) > 0)) {
    return null;
  }
  let lo = Math.log(min),
    hi = Math.log(max);
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (predict(Math.exp(mid)) < measured) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.exp((lo + hi) / 2);
}

/**
 * With a transcript the recording and the default head say the same
 * syllables, so the ratio of syllable rates is that of speaking times: the
 * speechRate whose predicted speech seconds (SPEECH_TIME of the planned
 * time) equal the measured ones.
 */
export function transcriptSpeechRate(speechSeconds, text, options = {}) {
  // Speaking time falls with speechRate; solve on its reciprocal.
  return solve(
    'speechRate',
    (rate) =>
      1 /
      (SPEECH_TIME.slope * plannedSpeechTime(text, rate, options) +
        SPEECH_TIME.offset),
    speechSeconds > 0 ? 1 / speechSeconds : 0,
    10
  );
}

/**
 * The pitchRange whose planned f0 range, times PLANNED_RANGE_RATIO, equals
 * the measured one: the range of a sentence depends on its words.
 */
export function transcriptPitchRange(semitones, text, options = {}) {
  return solve(
    'pitchRange',
    (range) => PLANNED_RANGE_RATIO * plannedPitchRange(text, range, options),
    semitones,
    10
  );
}
