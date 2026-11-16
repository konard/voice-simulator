/**
 * The whisper source (issue 53). In a whisper the vocal folds do not
 * vibrate: the glottis is held half open (Solomon et al. 1989: 40 ± 30 mm²
 * of glottal area against about 5 mm² in modal voice) and the air passing
 * it is turbulent. The `whisper` channel of the plan (0..1,
 * src/articulation/whisper.js) mixes the two sources:
 *
 * - the voiced part (pulses) is multiplied by `1 - whisper`; at whisper 1
 *   there is no pulse and the pulse phase stands still;
 * - the whisper noise has the drive `whisper * voicing * (1 - closure)`,
 *   halved inside the closure of a voiced stop (WHISPER_STOP_DRIVE), so
 *   the voiced obstruents keep a weaker source than the voiceless ones;
 * - the glottis opens by `whisper * whisperArea(E)` (`whisperPosture()`):
 *   WHISPER_AREA at normal effort, narrowing to STAGE_WHISPER_AREA in a
 *   stage whisper; the air flow (src/acoustics/aerodynamics.js) and the
 *   turbulence strength of issue 35 follow that area and the lung pressure
 *   of the effort;
 * - the noise is white noise through a band-pass at the Strouhal frequency
 *   of the glottal jet (`strouhalFrequency()` in voice.js), not the 800 Hz
 *   band of the aspiration of the voice: the formants come from the tract;
 *   it is not modulated by the pulses;
 * - the whole whisper is quiet: the noise sources (the whisper noise, the
 *   frication, the aspiration and the transient of the consonants) are
 *   WHISPER_CONSONANT_LEVEL dB down and follow the effort by
 *   WHISPER_EFFORT_SLOPE dB per dB, not by the noise rule of
 *   src/articulation/effort.js (`whisperQuiet()`); at a wide open tract
 *   the transient is left out (`whisperTransient()`);
 * - the whisper noise follows the intended pitch by
 *   WHISPER_PITCH_GAIN dB per semitone of the f0 channel above
 *   `head.pitch`, at most WHISPER_PITCH_LIMIT dB either way (Higashikawa
 *   et al. 1996: listeners hear the intended pitch of a whisper from its
 *   level and its spectrum);
 * - an open glottis reflects less of the tract's waves, which raises and
 *   widens the first formant: the reflection of the glottal end is
 *   `reflection * (1 - WHISPER_OPENING * whisper)` (`whisperReflection()`).
 *
 * Values between 0 and 1 give a whispery voice: pulses and noise. The
 * constants are tuned with `node experiments/issue-53-whisper-tuning.mjs`.
 */

import { EFFORT_RULES } from '../articulation/effort.js';

/** Glottal area (mm²) of a whisper at normal effort and below. */
export const WHISPER_AREA = 40;

/** Glottal area (mm²) of a stage whisper (effort 0.75 and above). */
export const STAGE_WHISPER_AREA = 20;

/** Effort (dB) at which the glottis reaches STAGE_WHISPER_AREA. */
export const STAGE_WHISPER_EFFORT = 10;

/**
 * Change of the glottal reflection per unit of whisper: the reflection is
 * `reflection * (1 - WHISPER_OPENING * whisper)`. Tuned so that F1 of
 * [a], [i] and [u] rises by 255 ± 90 Hz on average at tier `high`.
 */
export const WHISPER_OPENING = 0.6;

/** Drive of the whisper noise inside the closure of a voiced stop. */
export const WHISPER_STOP_DRIVE = 0.5;

/**
 * Oral constriction area (cm²) below which the tract counts as closed for
 * WHISPER_STOP_DRIVE (linear from 0 to this area).
 */
export const WHISPER_CLOSED_AREA = 0.05;

/**
 * Oral constriction area (cm²) above which a whisper has no burst
 * transient (whisperTransient): the tract is open.
 */
export const WHISPER_OPEN_AREA = 0.5;

/**
 * Level of the whisper noise against the turbulence strength of the
 * glottis: a whispered vowel at normal effort is about 25 dB below the
 * voiced one (Traunmüller & Eriksson 2000; Zhang & Hansen 2007).
 */
export const WHISPER_GAIN = 0.28;

/**
 * Level (dB) of the other noise sources in a whisper at whisper 1: the
 * frication, the aspiration of the consonants and the burst transient. A
 * whisper is a quiet register: its consonants keep their place against
 * its vowels (Tartter 1989), so the whole whisper is about 25 dB below
 * the voice, not only its vowels.
 */
export const WHISPER_CONSONANT_LEVEL = -10;

/** dB of whisper level per dB of effort: -30, -25, -20 dB at E -10, 0, +10. */
export const WHISPER_EFFORT_SLOPE = 0.5;

/** dB of whisper noise per semitone of intended pitch above head.pitch. */
export const WHISPER_PITCH_GAIN = 0.7;

/** Largest change (dB) of the whisper noise with the intended pitch. */
export const WHISPER_PITCH_LIMIT = 6;

/**
 * Glottal area (mm²) of a whisper at an effort of `E` dB: WHISPER_AREA up
 * to normal effort, narrowing linearly to STAGE_WHISPER_AREA at
 * STAGE_WHISPER_EFFORT and above.
 * @param {number} [E]
 */
export function whisperArea(E = 0) {
  const share = Math.min(1, Math.max(0, E / STAGE_WHISPER_EFFORT));
  return WHISPER_AREA + (STAGE_WHISPER_AREA - WHISPER_AREA) * share;
}

/**
 * Drive (0..1) of the whisper noise of a glottis control:
 * `whisper * voicing * (1 - closure)`, times WHISPER_STOP_DRIVE in the
 * closure of a voiced stop (`control.stopClosure`, 0..1, set by the
 * renderer from the oral constriction).
 * @param {{whisper?: number, voicing: number, closure: number, stopClosure?: number}} control
 */
export function whisperDrive(control) {
  const whisper = Math.min(1, Math.max(0, control.whisper ?? 0));
  if (whisper === 0) {
    return 0;
  }
  const voicing = Math.min(1, Math.max(0, control.voicing));
  const closure = Math.min(1, Math.max(0, control.closure ?? 0));
  const stop = Math.min(1, Math.max(0, control.stopClosure ?? 0));
  return whisper * voicing * (1 - closure) * (1 - (1 - WHISPER_STOP_DRIVE) * stop);
}

/**
 * Glottal area (cm²) that the whisper posture adds where the voice would
 * be voiced: `whisperDrive * whisperArea(E)`, in place of the voiced
 * opening (see glottalArea() of aerodynamics.js).
 * @param {{whisper?: number, voicing: number, closure: number, stopClosure?: number, effort?: number}} control
 */
export function whisperPosture(control) {
  return (whisperDrive(control) * whisperArea(control.effort ?? 0)) / 100;
}

/**
 * Factor on the whisper noise for the narrower glottis of a stage whisper:
 * the turbulence strength goes as √area, which this makes up for, so that
 * the level follows the effort by WHISPER_EFFORT_SLOPE (whisperQuiet).
 * @param {number} [E]
 */
export function whisperAreaGain(E = 0) {
  return E > 0 ? Math.sqrt(WHISPER_AREA / whisperArea(E)) : 1;
}

/**
 * Factor on the whisper noise for the intended pitch: WHISPER_PITCH_GAIN dB
 * per semitone of `f0` above `pitch`, limited to ±WHISPER_PITCH_LIMIT dB.
 * @param {number} f0 Hz (the f0 channel).
 * @param {number} pitch Hz (head.pitch).
 */
export function whisperPitchGain(f0, pitch) {
  if (!(f0 > 0) || !(pitch > 0)) {
    return 1;
  }
  const decibels = Math.min(
    WHISPER_PITCH_LIMIT,
    Math.max(-WHISPER_PITCH_LIMIT, WHISPER_PITCH_GAIN * 12 * Math.log2(f0 / pitch))
  );
  return 10 ** (decibels / 20);
}

/**
 * The whisper noise sample (before the source's aspiration level and the
 * 0.45 of the breath noise): `noise` times the drive, the turbulence
 * strength at the glottis (with whisperQuiet), WHISPER_GAIN and the area
 * and pitch gains.
 * @param {{whisper?: number, voicing: number, closure: number, stopClosure?: number, effort?: number, f0: number}} control
 * @param {number} noise Band-passed white noise.
 * @param {number} strength Relative turbulence strength at the glottis.
 * @param {number} pitch head.pitch (Hz).
 */
export function whisperNoise(control, noise, strength, pitch) {
  return (
    noise *
    whisperDrive(control) *
    strength *
    WHISPER_GAIN *
    whisperAreaGain(control.effort ?? 0) *
    whisperPitchGain(control.f0, pitch)
  );
}

/**
 * Factor on the burst transient (the change of the mean flow, see
 * VoiceRenderer) in a whisper: `1 - whisper * min(1, constriction /
 * WHISPER_OPEN_AREA)`. Through the half-open glottis the mean flow is
 * large (about 1.5 l/s), and the steps of the least area of an open tract
 * from one vowel to the next would make thumps that a whisper does not
 * have; at a narrow constriction (a release) the transient stays.
 * @param {number} whisper 0..1
 * @param {number} constriction Oral and nasal constriction area (cm²).
 */
export function whisperTransient(whisper, constriction) {
  const share = Math.min(1, Math.max(0, whisper));
  return 1 - share * Math.min(1, Math.max(0, constriction) / WHISPER_OPEN_AREA);
}

/**
 * Factor on the noise sources at a whisper (the whisper noise, the
 * frication, the aspiration of the consonants and the transient), times
 * the whisper: WHISPER_CONSONANT_LEVEL dB, and in place of the noise rule
 * of the effort (src/articulation/effort.js), which the sources already
 * carry, WHISPER_EFFORT_SLOPE dB per dB of effort.
 * @param {number} whisper 0..1
 * @param {number} [E] effort (dB)
 */
export function whisperQuiet(whisper, E = 0) {
  const share = Math.min(1, Math.max(0, whisper));
  const effort =
    E === 0 ? 0 : WHISPER_EFFORT_SLOPE * E - EFFORT_RULES.noise.value(E);
  return 10 ** (((WHISPER_CONSONANT_LEVEL + effort) * share) / 20);
}

/**
 * Reflection of the glottal end of the tract at a whisper:
 * `reflection * (1 - WHISPER_OPENING * whisper)`.
 * @param {number} reflection Reflection without whisper.
 * @param {number} whisper 0..1
 */
export function whisperReflection(reflection, whisper) {
  const share = Math.min(1, Math.max(0, whisper));
  return reflection * (1 - WHISPER_OPENING * share);
}
