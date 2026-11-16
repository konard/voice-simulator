/**
 * Phonation types (issue 54): breathy, lax, pressed, creaky, falsetto and
 * harsh voice. A type moves the shape parameter Rd of the LF pulse (Fant
 * 1995) from the speaker's own value towards its target and sets the
 * source channels of the plan that the glottis realises
 * (src/acoustics/glottis.js):
 *
 * - `breath` adds to the breathiness of the noise term and to the mean
 *   glottal area: breath noise 10 to 20 dB below the voiced part at 1
 *   (Klatt & Klatt 1990);
 * - `creak` lowers f0 by 12 semitones at 1 (not below 25 Hz), adds 10 %
 *   jitter and makes every second period longer and weaker (double
 *   pulsing; Gerratt & Kreiman 2001, Keating, Garellek & Kreiman 2015);
 * - `falsetto` raises f0 by 12 semitones and lowers the level by 6 dB;
 * - `harsh` adds 4 % jitter, 10 % shimmer and breath noise of breath 0.3.
 *
 * The Rd change becomes the `tension` channel (added to the tenseness of
 * the head, see src/articulation/effort.js), so the pulse itself moves:
 * `rd = rdVoice + d * (target - rdVoice)`, `tension = (rdVoice - rd) / 3`.
 *
 * Public Domain (Unlicense).
 */

import { BREATHINESS_RD, BREATHINESS_REFERENCE } from '../acoustics/glottis.js';

/**
 * Rd target and the other source channels of each phonation type at
 * degree 1. `lax` and `pressed` are the two signs of `mode.phonation.tension`.
 */
export const PHONATION = Object.freeze({
  breathy: Object.freeze({ rd: 2.5, breath: 1 }),
  lax: Object.freeze({ rd: 1.8 }),
  pressed: Object.freeze({ rd: 0.4 }),
  creaky: Object.freeze({ rd: 0.5, creak: 1 }),
  falsetto: Object.freeze({ rd: 2.3, falsetto: 1, breath: 0.3 }),
  harsh: Object.freeze({ rd: 0.4, harsh: 1 }),
});

/** The source channels a phonation type sets besides `tension`. */
export const PHONATION_CHANNELS = Object.freeze([
  'breath',
  'creak',
  'falsetto',
  'harsh',
]);

/**
 * Degree of the phonation of a segment written with a diacritic: breathy
 * voice `a̤` (U+0324) and creaky voice `a̰` (U+0330), the middle degree of
 * the markup (`DEFAULT_DEGREE`).
 */
export const SEGMENT_DEGREE = 0.67;

/**
 * The Rd of the speaker's own voice: `3 (1 - tenseness)` plus the change
 * of the head breathiness (`head.breathinessRd`, 0 at the default
 * breathiness 0.2), the value `lfParameters()` gives without tension.
 * @param {{tenseness?: number, breathiness?: number, breathinessRd?: number}} [head]
 */
export function voiceRd(head = {}) {
  const tenseness = head.tenseness ?? 0.6;
  const breathiness = head.breathiness ?? BREATHINESS_REFERENCE;
  const slope = head.breathinessRd ?? BREATHINESS_RD;
  return 3 * (1 - tenseness) + slope * (breathiness - BREATHINESS_REFERENCE);
}

/** The degree of each phonation type of a mode's `phonation`. */
function degrees(phonation = {}) {
  const tension = phonation.tension ?? 0;
  return {
    breathy: phonation.breathy ?? 0,
    lax: Math.max(0, -tension),
    pressed: Math.max(0, tension),
    creaky: phonation.creaky ?? 0,
    falsetto: phonation.falsetto ?? 0,
    harsh: phonation.harsh ?? 0,
  };
}

/**
 * The source channels of a phonation: `{tension, breath, creak, falsetto,
 * harsh}`. Each type at degree `d` (0..1) moves Rd from the voice's own
 * value (`voiceRd(head)`) to `rdVoice + d * (target - rdVoice)`; the
 * tension offsets of several types add up, the other channels take the
 * largest value. A token with `breathy` or `creaky` (`a̤`, `a̰`) has at
 * least `SEGMENT_DEGREE` of the type.
 * @param {{phonation?: object}|null|undefined} mode the mode of the token
 * @param {{breathy?: boolean, creaky?: boolean}|null} [token] its flags
 *   (pass null to ignore them)
 * @param {object} [head]
 * @returns {{tension: number, breath: number, creak: number, falsetto: number, harsh: number}}
 */
export function phonationChannels(mode, token, head) {
  const amounts = degrees(mode?.phonation);
  if (token?.breathy) {
    amounts.breathy = Math.max(amounts.breathy, SEGMENT_DEGREE);
  }
  if (token?.creaky) {
    amounts.creaky = Math.max(amounts.creaky, SEGMENT_DEGREE);
  }
  return channelsOf(amounts, head);
}

/**
 * The source channels of phonation degrees `{breathy, lax, pressed,
 * creaky, falsetto, harsh}` (missing ones 0), see `phonationChannels()`.
 * @param {Record<string, number>} amounts
 * @param {object} [head]
 */
export function channelsOf(amounts, head) {
  const rdVoice = voiceRd(head);
  const result = { tension: 0, breath: 0, creak: 0, falsetto: 0, harsh: 0 };
  for (const [name, row] of Object.entries(PHONATION)) {
    const degree = Math.min(1, Math.max(0, amounts[name] ?? 0));
    if (degree === 0) {
      continue;
    }
    const rd = rdVoice + degree * (row.rd - rdVoice);
    result.tension += (rdVoice - rd) / 3;
    for (const channel of PHONATION_CHANNELS) {
      result[channel] = Math.max(result[channel], degree * (row[channel] ?? 0));
    }
  }
  return result;
}

/** Whether a phonation leaves the source alone. */
export function isModal(channels) {
  return (
    channels.tension === 0 &&
    PHONATION_CHANNELS.every((name) => channels[name] === 0)
  );
}

/**
 * Pitch thresholds of phrase-final creak, as fractions of the speaker
 * pitch: creak starts below `onset` and is full `width` lower. Issue 54
 * proposed a width of 0.2, but the statements of the model end at 0.74 to
 * 0.81 of the pitch ("You are coming." at 89 Hz for 120 Hz,
 * experiments/issue-11-audit-m3b.txt), which gave a creak of 0.23 at most
 * and 2.7 % jitter in the last vowel of "You are coming." against the 5 %
 * the issue asks; at 0.1 it is 0.46 and 10.1 % (node
 * experiments/issue-54-scenarios.mjs).
 */
export const FINAL_CREAK = Object.freeze({ onset: 0.8, width: 0.1 });

/**
 * Phrase-final creak (`head.finalCreak`, issue 54): the creak in the last
 * syllable before `.` or `‖` where f0 falls below `FINAL_CREAK.onset` of
 * the speaker pitch, `finalCreak * min(1, (0.8 pitch - f0) / (0.1 pitch))`.
 * @param {number} f0 Hz
 * @param {number} pitch the head pitch, Hz
 * @param {number} finalCreak 0..1
 */
export function finalCreakAmount(f0, pitch, finalCreak) {
  const threshold = FINAL_CREAK.onset * pitch;
  if (!(finalCreak > 0) || !(f0 < threshold)) {
    return 0;
  }
  return (
    finalCreak * Math.min(1, (threshold - f0) / (FINAL_CREAK.width * pitch))
  );
}

/** Rd target of a breathy-voiced release (bʱ dʱ ɖʱ ɡʱ dʒʱ). */
export const BREATHY_RELEASE = Object.freeze({
  /** Seconds at speech rate 1. */
  duration: 0.08,
  rd: 2.5,
  breath: 1,
  /** Pitch lowering in semitones, gliding into the vowel. */
  pitch: -1.5,
});

/** The source channels of a breathy-voiced release. */
export function breathyReleaseChannels(head) {
  const rdVoice = voiceRd(head);
  return {
    tension: (rdVoice - BREATHY_RELEASE.rd) / 3,
    breath: BREATHY_RELEASE.breath,
    creak: 0,
    falsetto: 0,
    harsh: 0,
  };
}
