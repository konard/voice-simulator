/**
 * Vocal effort (issue 52): how a voice changes from soft speech to a
 * shout. The effort of a mode (0..1, see src/markup/modes.js) is written
 * in decibels, `E = (effort - 0.5) * 40`, from -20 to +20 dB, and moves
 * more than the level: the pitch rises, the spectrum gets flatter, the
 * first formant rises and vowels get longer.
 *
 * `EFFORT_RULES` lists the rules with their sources; `effortChanges()`
 * evaluates them. Where they are realised:
 *
 * - the planner fills the `effort` channel (dB) from `plan.modes` and the
 *   `tension` channel (offset on `head.tenseness`, `TENSION_PER_DB * E`),
 *   shifts the pitch, opens the jaw of open vowels (`effortJaw()`) and
 *   lengthens vowels (src/articulation/plan.js);
 * - the planner raises the lung pressure channel by `2^(E/9)`; the fold
 *   source (`source: 'folds'`) gets its level and tilt from it, so the
 *   level and tilt rules below are for the LF source only;
 * - the LF glottis adds the `tension` channel to its tenseness, multiplies
 *   its voiced part by `effortVoicedGain()` (`10^(E/20)` less LEVEL_TRIM,
 *   the level the pitch, tension, tilt and jaw add) and passes it through
 *   a shelf above TILT_CORNER (`effortTiltGain()`, TILT_SHELF), so that the
 *   level and the alpha ratio of an utterance follow the level and tilt
 *   rules (src/acoustics/glottis.js);
 * - the renderer scales the aspiration, frication and burst sources of
 *   both sources by `effortNoiseGain()` and `effortTransientGain()`, which
 *   take away the part of their growth with the lung pressure beyond the
 *   noise rule (src/acoustics/voice.js).
 *
 * The tuned values (TENSION_PER_DB, JAW_PER_DB, TILT_SHELF, LEVEL_TRIM and
 * the noise below normal effort) come from
 * `node experiments/issue-52-effort-tuning.mjs`.
 */

import { effortDecibels } from '../markup/modes.js';

/** Lowest and highest pitch shift of the effort, semitones. */
export const EFFORT_PITCH_LIMITS = Object.freeze({ min: -4, max: 12 });

/**
 * Offset on `head.tenseness` per dB of effort (LF source): a louder voice
 * is more pressed (lower H1-H2), a softer one more breathy. Tuned with
 * `node experiments/issue-52-effort-tuning.mjs` together with TILT_SHELF.
 */
export const TENSION_PER_DB = 0.006;

/**
 * Jaw opening of vowels in cm per dB of effort, above and below normal
 * effort ([below, above]). Tuned with
 * `node experiments/issue-52-effort-tuning.mjs` so that F1 of `ˈa` moves by
 * about 3.5 Hz per dB.
 */
export const JAW_PER_DB = Object.freeze([0.02, 0.035]);

/**
 * Gain (dB) of the tilt shelf of the voiced part (LF source) at an effort
 * of `E` dB, linear between the points ([E, dB]). Together with the tension
 * and the effort's own pitch rise it moves the alpha ratio of an utterance
 * (src/analysis/mode-features.js) by the tilt rule, `0.2 E` dB. Tuned with
 * `node experiments/issue-52-effort-tuning.mjs`.
 */
export const TILT_SHELF = Object.freeze([
  [-20, -6],
  [-10, -3],
  [0, 0],
  [10, 4.5],
  [20, 1],
]);

/**
 * Decibels taken from `E` in the gain of the voiced part (LF source) at an
 * effort of `E` dB, linear between the points ([E, dB]): the level the
 * pitch rise, the tension, the tilt shelf and the wider jaw add, so that
 * the level of an utterance follows the level rule. Tuned with
 * `node experiments/issue-52-effort-tuning.mjs`.
 */
export const LEVEL_TRIM = Object.freeze([
  [-20, -2],
  [-10, -1],
  [0, 0],
  [10, 2.5],
  [20, 5.9],
]);

/** Corner (Hz) of the second-order high-pass of the tilt shelf. */
export const TILT_CORNER = 1000;

/** The fastest effort ramp a span asks for without a warning, dB/s. */
export const EFFORT_RAMP_LIMIT = 40;

/** Value of a polyline through `points` ([x, y], sorted by x) at `x`. */
function polyline(points, x) {
  if (x <= points[0][0]) {
    return points[0][1];
  }
  for (let index = 1; index < points.length; index++) {
    const [x1, y1] = points[index];
    if (x <= x1) {
      const [x0, y0] = points[index - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points.at(-1)[1];
}

/** Factor on vowel durations: 1, 1.1 and 1.3 at 0, +10 and +20 dB. */
const VOWEL_DURATION = Object.freeze([
  [0, 1],
  [10, 1.1],
  [20, 1.3],
]);

/**
 * The rules of vocal effort: per quantity its unit, its value at `E` dB
 * (and the head, for the pitch) and its source. Linear between the listed
 * points; the values at -10, +10 and +20 dB are in docs/markup.md.
 */
export const EFFORT_RULES = Object.freeze({
  level: Object.freeze({
    unit: 'dB',
    value: (E) => E,
    source: 'definition',
  }),
  lungPressure: Object.freeze({
    unit: 'factor',
    value: (E) => 2 ** (E / 9),
    source: 'Titze & Sundberg 1992: 8-9 dB per doubling of the pressure',
  }),
  pitch: Object.freeze({
    unit: 'st',
    value: (E, head = {}) => {
      const pitch = head.pitch ?? 120;
      const target = Math.max(1e-6, pitch + 5 * E);
      const shift = 12 * Math.log2(target / pitch);
      return Math.min(
        EFFORT_PITCH_LIMITS.max,
        Math.max(EFFORT_PITCH_LIMITS.min, shift)
      );
    },
    source: 'Liénard & Di Benedetto 1999: +5 Hz per dB',
  }),
  f1: Object.freeze({
    unit: 'Hz',
    value: (E) => 3.5 * E,
    source: 'Liénard & Di Benedetto 1999',
  }),
  f2: Object.freeze({ unit: 'Hz', value: () => 0, source: 'unchanged' }),
  f3: Object.freeze({ unit: 'Hz', value: () => 0, source: 'unchanged' }),
  tilt: Object.freeze({
    unit: 'dB',
    value: (E) => 0.2 * E,
    source:
      'Liénard & Di Benedetto 1999: F3 gains 2 dB over F1 per 10 dB of effort',
  }),
  vowelDuration: Object.freeze({
    unit: 'factor',
    value: (E) => polyline(VOWEL_DURATION, E),
    source: 'research notes (proposal)',
  }),
  consonantDuration: Object.freeze({
    unit: 'factor',
    value: () => 1,
    source: 'research notes (proposal)',
  }),
  noise: Object.freeze({
    unit: 'dB',
    value: (E) => (E < 0 ? 1.25 * E : 0.5 * E),
    source:
      'project choice: 0.5 E above normal effort; 1.25 E below it, where the airflow (and with it the turbulence) falls with the lung pressure',
  }),
});

/**
 * The changes of every rule at an effort of `E` dB: `level` (dB),
 * `lungPressure` (factor), `pitch` (semitones re `head.pitch`), `f1`, `f2`,
 * `f3` (Hz), `tilt` (dB gained above 1 kHz), `vowelDuration` and
 * `consonantDuration` (factors) and `noise` (dB).
 * @param {number} E Effort in dB, -20 to +20 (0 is normal).
 * @param {{pitch?: number}} [head] The speaker's pitch (Hz) for the pitch
 *   rule; 120 Hz without one.
 * @returns {Record<keyof typeof EFFORT_RULES, number>}
 */
export function effortChanges(E, head = {}) {
  return Object.fromEntries(
    Object.entries(EFFORT_RULES).map(([name, rule]) => [
      name,
      rule.value(E, head),
    ])
  );
}

/**
 * Factor on the turbulence sources (aspiration, frication, burst) at an
 * effort of `E` dB. The lung pressure rises by `2^(E/9)` and a turbulence
 * source grows with the pressure drop to the power 1.5 (aerodynamics.js),
 * which alone would raise the noise by about E dB; this factor brings it to
 * the noise rule (`0.5 E` dB above normal effort, `1.25 E` below).
 * @param {number} E
 */
export function effortNoiseGain(E) {
  if (E === 0) {
    return 1;
  }
  return (
    10 ** (EFFORT_RULES.noise.value(E) / 20) /
    EFFORT_RULES.lungPressure.value(E) ** 1.5
  );
}

/**
 * Factor on the burst transient at an effort of `E` dB: the flow grows
 * with the square root of the pressure, so the transient gets
 * `10^(noise(E)/20) / 2^(E/18)`.
 * @param {number} E
 */
export function effortTransientGain(E) {
  if (E === 0) {
    return 1;
  }
  return (
    10 ** (EFFORT_RULES.noise.value(E) / 20) /
    EFFORT_RULES.lungPressure.value(E) ** 0.5
  );
}

/**
 * Gain on the voiced part of the LF source at an effort of `E` dB:
 * `10^((E - trim)/20)` with the trim of LEVEL_TRIM.
 * @param {number} E
 */
export function effortVoicedGain(E) {
  if (E === 0) {
    return 1;
  }
  return 10 ** ((EFFORT_RULES.level.value(E) - polyline(LEVEL_TRIM, E)) / 20);
}

/**
 * The jaw opening of a vowel (cm) at an effort of `E` dB: `JAW_PER_DB * E`
 * for an open vowel, less for closer ones, none for a close vowel (height
 * 1), whose level would otherwise rise far more than that of an open one.
 * @param {number} E
 * @param {number} [height] vowel height, 0 (open) to 1 (close)
 */
export function effortJaw(E, height = 0) {
  return E * JAW_PER_DB[E < 0 ? 0 : 1] * (1 - Math.min(1, Math.max(0, height)));
}

/** Factor of the tilt shelf above TILT_CORNER at `E` dB (TILT_SHELF). */
export function effortTiltGain(E) {
  return E === 0 ? 1 : 10 ** (polyline(TILT_SHELF, E) / 20);
}

/** Effort in dB of an effort value (0..1). */
export const effortToDecibels = effortDecibels;

/** Effort (0..1) of a level change in dB, `0.5 + E / 40`. */
export function decibelsToEffort(decibels) {
  return 0.5 + decibels / 40;
}

/**
 * Sound pressure level (dB SPL at 1 m) of an effort: effort 0.5 is 60 dB
 * SPL, conversational speech (docs/markup.md, level convention).
 * @param {number} effort 0..1
 */
export function effortToSpl(effort) {
  return 60 + effortDecibels(effort);
}

/**
 * Effort of a sound pressure level (dB SPL at 1 m); the inverse of
 * `effortToSpl`, not clamped.
 * @param {number} spl
 */
export function splToEffort(spl) {
  return decibelsToEffort(spl - 60);
}

/** The effort in dB of a mode span at a fraction (0..1) of it. */
export function spanEffort(span, fraction = 0) {
  const start = effortDecibels(span.effort);
  return start + (effortDecibels(span.effortEnd) - start) * fraction;
}

/**
 * Mode spans (`plan.modes`) whose effort moves faster than `limit` dB/s:
 * `{start, end, rate}` with `rate` in dB/s.
 * @param {{start: number, end: number, effort: number, effortEnd: number}[]} modes
 * @param {number} [limit]
 */
export function fastEffortRamps(modes, limit = EFFORT_RAMP_LIMIT) {
  const found = [];
  for (const span of modes) {
    const change = Math.abs(spanEffort(span, 1) - spanEffort(span, 0));
    const length = span.end - span.start;
    if (change > 0 && length > 0 && change / length > limit) {
      found.push({ start: span.start, end: span.end, rate: change / length });
    }
  }
  return found;
}

/**
 * The largest level of the mode spans, `E + gain` in dB, and at least 0:
 * the headroom the output needs so that the loudest span has the level of
 * plain speech.
 * @param {{effort: number, effortEnd: number, gain: number}[]} modes
 */
export function maxModeLevel(modes) {
  let highest = 0;
  for (const span of modes) {
    const effort = Math.max(spanEffort(span, 0), spanEffort(span, 1));
    highest = Math.max(highest, effort + (span.gain ?? 0));
  }
  return highest;
}
