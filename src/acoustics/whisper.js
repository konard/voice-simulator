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
 *   halved in the closure of a voiced stop (WHISPER_STOP_DRIVE) and
 *   quartered in a voiced fricative (WHISPER_FRICATIVE_DRIVE), so that the
 *   voiced obstruents keep a narrower glottis, less air and a weaker
 *   source than the voiceless ones;
 * - the glottis opens by `whisper * whisperArea(E)` (`whisperPosture()`):
 *   WHISPER_AREA at normal effort, narrowing to STAGE_WHISPER_AREA in a
 *   stage whisper; the air flow (src/acoustics/aerodynamics.js) and the
 *   turbulence strength of issue 35 follow that area and the lung pressure
 *   of the effort;
 * - the noise is white noise through a low-pass at the Strouhal frequency
 *   of the glottal jet (`strouhalFrequency()` and NoiseSources in
 *   voice.js), not the 800 Hz band of the aspiration of the voice: the
 *   formants come from the tract; it is not modulated by the pulses;
 * - the whole whisper is quiet: the noise sources (the whisper noise, the
 *   frication, the aspiration and the transient of the consonants) are
 *   WHISPER_CONSONANT_LEVEL dB down and follow the effort by
 *   WHISPER_EFFORT_SLOPE dB per dB below normal effort and
 *   STAGE_WHISPER_SLOPE above it, not by the noise rule of
 *   src/articulation/effort.js (`whisperQuiet()`); the transient is kept
 *   only for the burst of a stop (`whisperTransient()`);
 * - the whisper noise follows the intended pitch by
 *   WHISPER_PITCH_GAIN dB per semitone of the f0 channel above
 *   `head.pitch`, at most WHISPER_PITCH_LIMIT dB either way (Higashikawa
 *   et al. 1996: listeners hear the intended pitch of a whisper from its
 *   level and its spectrum);
 * - an open glottis reflects less of the tract's waves, which raises and
 *   widens the first formant: the reflection of the glottal end is
 *   `reflection * (1 - WHISPER_OPENING * whisper)` (`whisperReflection()`).
 *   Past a whisper of 1 / WHISPER_OPENING (0.61) it turns negative: the glottis is then an
 *   open end towards the trachea, and the tract is on its way from a
 *   closed-open tube to an open-open one, whose resonances are higher. The
 *   coupling of issue 34 (source-tract interaction) gives the folds the
 *   load of the tract and of the trachea, but only for the fold source
 *   with interaction, which leaves the reflection at 1; every other source
 *   (the LF pulses by default) has only this reflection to show the open
 *   glottis, so WHISPER_OPENING stays for them.
 *
 * Values between 0 and 1 give a whispery voice: pulses and noise, the noise
 * WHISPERY_BOOST dB louder at whisper 0.5 (`whisperyGain()`). The
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
 * `reflection * (1 - WHISPER_OPENING * whisper)`, -0.49 at whisper 1 with
 * the default head. Tuned from 0.6 so that F1 of [a], [i] and [u] rises
 * by 255 ± 90 Hz on average at tier `high`, the target of issue 53
 * (Jovičić 1998: whispered vowels have higher formants, F1 most):
 * +265, +120 and +140 Hz, mean 175 Hz (one LPC fit over the middle 60 %
 * of the vowel), with `node experiments/issue-53-whisper-tuning.mjs`. The
 * reflection of fdtd3d stops at MIN_GLOTTAL_REFLECTION (-0.5), so a larger
 * opening adds little there.
 */
export const WHISPER_OPENING = 1.65;

/**
 * Drive of the whisper noise, and share of the whisper posture of the
 * glottis, in the closure of a voiced stop: a whispered [b] keeps a
 * narrower glottis than [p], so less air and a weaker burst.
 */
export const WHISPER_STOP_DRIVE = 0.5;

/**
 * Drive of the whisper noise, and share of the whisper posture of the
 * glottis, in a voiced fricative (times the frication gain of the plan). A
 * whispered [z] keeps a narrower glottis than [s] (Tartter 1989: the
 * whispered voiced fricatives are weaker and shorter): with a glottis of
 * about 0.1 cm² against the 0.25 cm² of [s] less of the lung pressure
 * drops at the constriction, and its frication is more than 3 dB weaker
 * (`node experiments/issue-53-contrasts.mjs`).
 */
export const WHISPER_FRICATIVE_DRIVE = 0.25;

/**
 * Oral constriction area (cm²) below which the tract counts as closed for
 * WHISPER_STOP_DRIVE (linear from 0 to this area).
 */
export const WHISPER_CLOSED_AREA = 0.05;

/**
 * Time constant (s) of the burst transient that a whisper keeps after a
 * closure of the mouth (whisperTransient): the release of a stop.
 */
export const WHISPER_RELEASE_TIME = 0.02;

/**
 * Level of the whisper noise against the turbulence strength of the
 * glottis: a whisper at normal effort is about 25 dB below the voice
 * (Traunmüller & Eriksson 2000; Zhang & Hansen 2007). `[whisper]Please
 * call Stella.[/whisper]` is 25.9 dB below the plain sentence at tier
 * `medium` (`node experiments/issue-53-quick.mjs`).
 */
export const WHISPER_GAIN = 1.2;

/**
 * Level (dB) of the other noise sources in a whisper at whisper 1: the
 * frication, the aspiration of the consonants and the burst transient. A
 * whisper is a quiet register: its consonants keep their place against
 * its vowels (Tartter 1989), so the whole whisper is about 25 dB below
 * the voice, not only its vowels.
 */
export const WHISPER_CONSONANT_LEVEL = -10;

/**
 * dB of whisper per dB of effort below normal effort (a soft whisper). The
 * effort's lung pressure is taken out (see whisperQuiet()), so that this
 * is the whole change.
 */
export const WHISPER_EFFORT_SLOPE = 0.42;

/**
 * dB of whisper per dB of effort above normal effort, on top of the
 * narrower glottis of the stage whisper (STAGE_WHISPER_AREA), which takes
 * more of the pressure drop from the tract and makes the turbulence
 * stronger by itself (about +6 dB), so the slope is slightly negative.
 * The level of `Please call Stella.` is -5.9 dB at soft and +5.1 dB at
 * loud against the whisper at normal effort, for -30, -25 and -20 dB
 * against the voice (`node experiments/issue-53-quick.mjs`).
 */
export const STAGE_WHISPER_SLOPE = -0.1;

/**
 * Extra level (dB) of the whisper noise of a whispery voice, at whisper 0.5
 * (`whisperyGain()`): with pulses the noise is not a quiet register but the
 * turbulence of a leaky glottis next to the voice, loud enough to bring
 * the harmonics-to-noise ratio below 10 dB (Laver 1980: whispery voice is
 * "audible friction" at the glottis with vibration): `{Ṿ ˈama Ṿ}` has
 * 8.9 dB against 21.9 dB of `ˈama`, voiced share 0.94
 * (`node experiments/issue-53-quick.mjs`).
 */
export const WHISPERY_BOOST = 6;

/** The pitch (Hz) of a head that gives none (as src/articulation/effort.js). */
const DEFAULT_PITCH = 120;

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
 * renderer from the oral constriction) and WHISPER_FRICATIVE_DRIVE in a
 * voiced fricative (`control.fricative`, 0..1, its frication gain).
 * @param {{whisper?: number, voicing: number, closure: number, stopClosure?: number, fricative?: number}} control
 */
export function whisperDrive(control) {
  const whisper = Math.min(1, Math.max(0, control.whisper ?? 0));
  if (whisper === 0) {
    return 0;
  }
  const voicing = Math.min(1, Math.max(0, control.voicing));
  const closure = Math.min(1, Math.max(0, control.closure ?? 0));
  const stop = Math.min(1, Math.max(0, control.stopClosure ?? 0));
  const fricative = Math.min(1, Math.max(0, control.fricative ?? 0));
  return (
    whisper *
    voicing *
    (1 - closure) *
    (1 - (1 - WHISPER_STOP_DRIVE) * stop) *
    (1 - (1 - WHISPER_FRICATIVE_DRIVE) * fricative)
  );
}

/**
 * Glottal area (cm²) that the whisper posture adds where the voice would
 * be voiced: `whisperDrive * whisperArea(E)`, in place of the voiced
 * opening (see glottalArea() of aerodynamics.js).
 * @param {{whisper?: number, voicing: number, closure: number, stopClosure?: number, fricative?: number, effort?: number}} control
 */
export function whisperPosture(control) {
  return (whisperDrive(control) * whisperArea(control.effort ?? 0)) / 100;
}

/**
 * Oral constriction (cm²) of the air flow in a whisper: the narrowest area
 * from the velum to the lips (or the frication area where the plan asks
 * for frication and it is narrower), plus the velum opening. The frication
 * area of a shape is the narrowest area near the tongue location, and a
 * vowel keeps the location of the consonant before it (it has no tongue
 * constriction of its own): after [h] it is the larynx tube, about
 * 0.3 cm². Against the few mm² of a voiced glottis that does not matter,
 * but against the 40 mm² of a whisper it would take most of the pressure
 * drop and make the vowel of `ˈhḁ` 16 dB quieter than a lone [ḁ].
 * @param {{areas: ArrayLike<number>, velumIndex: number, velumArea: number, frication: {area: number, gain: number}}} shape
 */
export function whisperConstriction(shape) {
  const { areas, frication } = shape;
  let narrowest = Infinity;
  for (
    let index = Math.max(0, shape.velumIndex);
    index < areas.length;
    index++
  ) {
    narrowest = Math.min(narrowest, areas[index]);
  }
  if (frication.gain > 0 && frication.area < narrowest) {
    narrowest = frication.area;
  }
  return (
    (Number.isFinite(narrowest) ? narrowest : frication.area) + shape.velumArea
  );
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
    Math.max(
      -WHISPER_PITCH_LIMIT,
      WHISPER_PITCH_GAIN * 12 * Math.log2(f0 / pitch)
    )
  );
  return 10 ** (decibels / 20);
}

/**
 * Factor on the whisper noise of a whispery voice: WHISPERY_BOOST dB times
 * `4 * whisper * (1 - whisper)`, so 1 for a modal voice and for a whisper.
 * @param {number} whisper 0..1
 */
export function whisperyGain(whisper) {
  const share = Math.min(1, Math.max(0, whisper));
  return 10 ** ((WHISPERY_BOOST * 4 * share * (1 - share)) / 20);
}

/** Store the gains shared by all whisper noise samples of a control block. */
export function prepareWhisperGains(control, pitch, gains) {
  gains.drive = whisperDrive(control);
  gains.pitch = whisperPitchGain(control.f0, pitch ?? DEFAULT_PITCH);
  gains.mix = whisperyGain(control.whisper ?? 0);
}

/**
 * The whisper noise sample (before the source's aspiration level and the
 * 0.45 of the breath noise): `noise` times the drive, the turbulence
 * strength at the glottis (with whisperQuiet), WHISPER_GAIN and the area,
 * pitch and whispery gains.
 * @param {{whisper?: number, voicing: number, closure: number, stopClosure?: number, fricative?: number, effort?: number, f0: number}} control
 * @param {number} noise Band-passed white noise.
 * @param {number} strength Relative turbulence strength at the glottis.
 * @param {number} [pitch] head.pitch (Hz, default DEFAULT_PITCH).
 * @param {{drive: number, pitch: number, mix: number}} [gains]
 */
export function whisperNoise(control, noise, strength, pitch, gains) {
  return (
    noise *
    (gains ? gains.drive : whisperDrive(control)) *
    strength *
    WHISPER_GAIN *
    (gains
      ? gains.pitch
      : whisperPitchGain(control.f0, pitch ?? DEFAULT_PITCH)) *
    (gains ? gains.mix : whisperyGain(control.whisper ?? 0))
  );
}

/**
 * Factor on the burst transient (the change of the mean flow, see
 * VoiceRenderer) in a whisper: `1 - whisper * (1 - release)`, where
 * `release` is 1 while the mouth is closed and decays with
 * WHISPER_RELEASE_TIME after it opens. Through the half-open glottis the
 * mean flow is large (about 1.5 l/s), and its steps from one vowel to the
 * next, or from a fricative (which has no burst) to its vowel, would make
 * thumps louder than the whisper; the burst of a stop stays.
 * @param {number} whisper 0..1
 * @param {number} release 0..1, 1 at a closure of the mouth.
 */
export function whisperTransient(whisper, release) {
  const share = Math.min(1, Math.max(0, whisper));
  return 1 - share * (1 - Math.min(1, Math.max(0, release)));
}

/**
 * Factor on the noise sources at a whisper (the whisper noise, the
 * frication, the aspiration of the consonants and the transient), times
 * the whisper: WHISPER_CONSONANT_LEVEL dB, and in place of the noise rule
 * of the effort (src/articulation/effort.js), which the sources already
 * carry, WHISPER_EFFORT_SLOPE dB per dB of effort below normal effort and
 * STAGE_WHISPER_SLOPE above it.
 * @param {number} whisper 0..1
 * @param {number} [E] effort (dB)
 */
export function whisperQuiet(whisper, E = 0) {
  const share = Math.min(1, Math.max(0, whisper));
  const effort =
    E === 0
      ? 0
      : (E < 0 ? WHISPER_EFFORT_SLOPE : STAGE_WHISPER_SLOPE) * E -
        EFFORT_RULES.noise.value(E);
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
