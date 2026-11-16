/**
 * Vocal fold source: Liljencrants-Fant (LF) glottal flow derivative with
 * the one-parameter Rd shaping of Fant (1995), plus aspiration noise that
 * is modulated by the glottal opening. The parametrisation follows the
 * well known Pink Trombone glottis (Neil Thapen, MIT licence).
 *
 * A posterior glottal chink, a gap that stays open through the cycle, adds
 * two effects (Hanson and Chuang 1999, JASA 106, table II): the air in it
 * cannot stop at once, which low-pass filters the pulse with a time
 * constant of about 1.1 sqrt(A) ms (A in cm², 0.23 ms for 5 mm², 12 dB less
 * at 2.5 kHz), and the open glottis absorbs more, widening the formants by
 * about 1550 A Hz. Women have such chinks far more often than men, which
 * makes their H1-A3 about 10 dB larger.
 */

import { randomNormal, createRandom } from '../random.js';
import { SPEED_OF_SOUND } from './transfer.js';
import { glottalArea, openTractStrength } from './aerodynamics.js';
import {
  effortNoiseGain,
  effortTiltGain,
  effortVoicedGain,
  TILT_CORNER,
} from '../articulation/effort.js';
import { whisperNoise, whisperQuiet } from './whisper.js';

/**
 * Breath noise per 10 mm² of glottal chink (issue 35): the air leaking
 * through a gap that stays open through the cycle is turbulent too.
 */
export const CHINK_NOISE = 0.5;

/** Lung pressure (Pa) of a source that is given none (head default). */
const DEFAULT_LUNG_PRESSURE = 800;

/** Reflection of the tract at a closed glottis (no chink). */
export const GLOTTAL_REFLECTION = 0.75;

/**
 * Time constant (s) of the flow cutoff through a glottal chink.
 * @param {number} chink Area (mm²).
 */
export function chinkTimeConstant(chink) {
  return 1.1e-3 * Math.sqrt(Math.max(0, chink) / 100);
}

/**
 * Reflection of the tract at the glottis, lowered so that a chink widens
 * the formants of a tract of the head's length by 1550 A Hz.
 * @param {{glottalChink?: number, vocalTractLength?: number}} [head]
 */
export function glottalReflection(head = {}) {
  const bandwidth = 15.5 * Math.max(0, head.glottalChink ?? 0);
  const length = head.vocalTractLength ?? 16.5;
  return (
    GLOTTAL_REFLECTION *
    Math.exp((-2 * Math.PI * length * bandwidth) / SPEED_OF_SOUND)
  );
}

/**
 * Change of the LF shape parameter Rd per unit of breathiness: a breathy
 * voice has a longer open phase and a stronger first harmonic (H1-H2 of 7
 * to 12 dB against 0 to 4 dB for a modal voice; Klatt and Klatt 1990,
 * Hanson 1997).
 */
export const BREATHINESS_RD = 1.5;

/** Breathiness at which the pulse depends on tenseness alone (default). */
export const BREATHINESS_REFERENCE = 0.2;

/**
 * Gain and exponent of the breath noise against breathiness:
 * `BREATH_GAIN * breathiness ** BREATH_EXPONENT`, then scaled by the
 * turbulence source strength at the glottis (src/acoustics/aerodynamics.js),
 * which grows with the glottal area that breathiness opens. The default
 * breathiness 0.2 keeps the noise about 40 dB below the pulses at the
 * source, and breathiness 1 brings it to about 10 dB below them, the level
 * of a clearly breathy voice (Klatt and Klatt 1990: 10 to 20 dB below the
 * voiced part). The pulse grows by about 3 dB from breathiness 0.2 to 1
 * (its longer open phase) and the source strength by 3.3 dB (glottal area
 * 0.07 to 0.15 cm²), so the gain rises by 30 dB to give 30 dB more noise
 * against the pulses. Measured with part 1 of
 * experiments/issue-11-audit-m2.mjs (tuning in
 * experiments/issue-35-breath-tuning.mjs).
 */
export const BREATH_GAIN = 3.87;
export const BREATH_EXPONENT = 2.114;

/**
 * Source changes of the phonation channels at 1 (issue 54,
 * src/articulation/phonation.js):
 *
 * - `creakSemitones`, `creakFloor`: creak lowers f0 by 12 semitones, but not
 *   below 25 Hz (vocal fry lies at 20 to 70 Hz; Blomgren et al. 1998);
 * - `creakJitter`: 10 % more jitter (standard deviation);
 * - `creakPulseGain`, `creakPulseLength`: double pulsing, every second
 *   period is weaker (times `1 - 0.5 c`) and longer (times `1 + 0.2 c`),
 *   the alternation of creaky voice (Gerratt and Kreiman 2001);
 * - `falsettoSemitones`, `falsettoDecibels`: falsetto raises f0 by 12
 *   semitones and lowers the voiced part by 6 dB;
 * - `falsettoCorner`: the thin, stiff folds of falsetto barely close, so
 *   the flow is nearly sinusoidal: a one-pole low-pass at `1.5 f0 / f`
 *   smooths the pulse (H1-H2 of the source about 3 dB higher);
 * - `harshJitter`, `harshShimmer`, `harshBreath`: harsh voice adds 4 %
 *   jitter, 10 % shimmer and the breath noise of breath 0.3;
 * - `breathNoise`: the breathiness that `breath` 1 adds, 0.6: with the
 *   head default 0.2 the breath noise of breathy voice (Rd 2.5) lies
 *   13.6 dB below the pulses at the source, within the 10 to 20 dB of
 *   Klatt and Klatt (1990); 1 gave 8.9 dB (node
 *   experiments/issue-54-source.mjs).
 */
export const PHONATION_SOURCE = Object.freeze({
  creakSemitones: 12,
  creakFloor: 25,
  creakJitter: 10,
  creakPulseGain: 0.5,
  creakPulseLength: 0.2,
  falsettoSemitones: 12,
  falsettoDecibels: -6,
  harshJitter: 4,
  harshShimmer: 10,
  harshBreath: 0.3,
  falsettoCorner: 1.5,
  breathNoise: 0.6,
});

/** Lowest f0 (Hz) a period can have (vocal fry). */
export const MIN_F0 = 20;

/**
 * f0 of the glottis under creak `c` and falsetto `f` (0..1): shifted by
 * `12 (f - c)` semitones, but not below 25 Hz (nor below `f0` itself).
 * @param {number} f0 Hz
 * @param {number} creak
 * @param {number} falsetto
 */
export function phonationF0(f0, creak, falsetto) {
  if (creak === 0 && falsetto === 0) {
    return f0;
  }
  const source = PHONATION_SOURCE;
  const shifted =
    f0 *
    2 **
      ((falsetto * source.falsettoSemitones - creak * source.creakSemitones) /
        12);
  return creak > 0
    ? Math.max(Math.min(f0, source.creakFloor), shifted)
    : shifted;
}

/**
 * Breathiness of the breath noise and the glottal area with the phonation
 * channels `breath` and `harsh` (issue 54): the head breathiness plus
 * `0.6 (breath + 0.3 harsh)` (PHONATION_SOURCE.breathNoise), up to 1
 * (where the noise lies about 10 dB below the pulses, see BREATH_GAIN).
 * The head value alone without them.
 * @param {number} breathiness the head value
 * @param {number} [breath]
 * @param {number} [harsh]
 */
export function noiseBreathiness(breathiness, breath = 0, harsh = 0) {
  const extra =
    PHONATION_SOURCE.breathNoise *
    (breath + PHONATION_SOURCE.harshBreath * harsh);
  if (extra === 0) {
    return breathiness;
  }
  return Math.max(breathiness, Math.min(1, breathiness + extra));
}

/**
 * LF pulse parameters for a tenseness value (0 = breathy/lax, 1 = pressed)
 * and a breathiness value (0 = clear, 1 = very breathy). Both set the Rd
 * shape parameter of Fant (1995): 0.3 to 0.5 is a pressed voice, 2.7 a
 * very breathy one. The default breathiness leaves the pulse of tenseness alone.
 * The pulse is normalised to period 1 and a negative peak of about -1.
 * @param {number} tenseness
 * @param {number} [breathiness]
 * @param {number} [rdSlope] Change of Rd per unit of breathiness
 *   (head.breathinessRd, BREATHINESS_RD by default).
 */
export function lfParameters(
  tenseness,
  breathiness = BREATHINESS_REFERENCE,
  rdSlope = BREATHINESS_RD
) {
  const rd = Math.min(
    2.7,
    Math.max(
      0.3,
      3 * (1 - tenseness) + rdSlope * (breathiness - BREATHINESS_REFERENCE)
    )
  );
  const ra = -0.01 + 0.048 * rd;
  const rk = 0.224 + 0.118 * rd;
  const rg =
    ((rk / 4) * (0.5 + 1.2 * rk)) / (0.11 * rd - ra * (0.5 + 1.2 * rk));
  const ta = ra;
  const tp = 1 / (2 * rg);
  const te = tp + tp * rk;
  const epsilon = 1 / ta;
  const shift = Math.exp(-epsilon * (1 - te));
  const delta = 1 - shift;
  const returnIntegral =
    ((1 / epsilon) * (shift - 1) + (1 - te) * shift) / delta;
  const upperIntegral = (te - tp) / 2 - returnIntegral;
  const omega = Math.PI / tp;
  const sine = Math.sin(omega * te);
  const y = (-Math.PI * sine * upperIntegral) / (tp * 2);
  const alpha = Math.log(y) / (tp / 2 - te);
  const e0 = -1 / (sine * Math.exp(alpha * te));
  return { rd, alpha, e0, epsilon, shift, delta, te, omega };
}

/**
 * Normalised LF flow derivative at phase t in [0, 1).
 * @param {ReturnType<typeof lfParameters>} p
 * @param {number} t
 */
export function lfWaveform(p, t) {
  if (t > p.te) {
    return (-Math.exp(-p.epsilon * (t - p.te)) + p.shift) / p.delta;
  }
  return p.e0 * Math.exp(p.alpha * t) * Math.sin(p.omega * t);
}

export class Glottis {
  /**
   * @param {{seed?: string|number, tenseness?: number, breathiness?: number, jitter?: number, shimmer?: number, aspirationLevel?: number, chink?: number, lungPressure?: number}} [options]
   *   `jitter` and `shimmer` are standard deviations in percent, `chink`
   *   the area of the glottal chink in mm², `lungPressure` (Pa) the
   *   pressure used when the control gives none. `head` gives the advanced
   *   source values (breathinessRd, breathGain, breathExponent, chinkNoise,
   *   glottisVoiced, glottisOpen, glottisBreathy, reCritical); each falls
   *   back to its constant.
   */
  constructor(options = {}) {
    this.random = createRandom(`${options.seed ?? 1}:glottis`);
    this.tenseness = options.tenseness ?? 0.6;
    this.breathiness = options.breathiness ?? 0.2;
    this.jitterDepth = 0.01 * (options.jitter ?? 0.4);
    this.shimmerDepth = 0.01 * (options.shimmer ?? 3);
    this.aspirationLevel = options.aspirationLevel ?? 1;
    this.chink = Math.max(0, options.chink ?? 0);
    this.chinkTime = chinkTimeConstant(this.chink);
    this.lungPressure = options.lungPressure ?? DEFAULT_LUNG_PRESSURE;
    const head = options.head ?? {};
    this.rdSlope = head.breathinessRd ?? BREATHINESS_RD;
    this.breathGain = head.breathGain ?? BREATH_GAIN;
    this.breathExponent = head.breathExponent ?? BREATH_EXPONENT;
    this.chinkNoise = head.chinkNoise ?? CHINK_NOISE;
    this.reCritical = head.reCritical;
    this.areas = head;
    /** The speaker's pitch (Hz): the whisper noise follows f0 against it. */
    this.pitch = head.pitch;
    this.strengthKey = [NaN, NaN];
    this.strength = 0;
    this.smoothed = 0;
    this.phase = 0;
    this.period = 1 / 120;
    this.jitter = 1;
    this.shimmer = 1;
    this.parity = 0;
    this.pulseGain = 1;
    this.falsettoSmoothed = 0;
    this.intensity = 0;
    this.pulse = lfParameters(this.tenseness, this.breathiness, this.rdSlope);
    this.noiseModulation = 0;
    this.effortKey = 0;
    this.effortGain = 1;
    this.tiltGain = 1;
    this.tiltStep = 0;
    this.tiltPole = 0;
    this.tiltInput = 0;
    this.tiltMiddle = 0;
    this.tiltOutput = 0;
  }

  /**
   * Gains of the voiced part at `effort` dB (cached): the level
   * (`effortVoicedGain()`) and the tilt shelf above TILT_CORNER.
   */
  #effortGains(effort) {
    if (effort !== this.effortKey) {
      this.effortKey = effort;
      this.effortGain = effortVoicedGain(effort);
      this.tiltGain = effortTiltGain(effort);
    }
  }

  /**
   * The voiced sample through the tilt shelf: plus `tiltGain - 1` times its
   * second-order high-pass at TILT_CORNER (two first-order sections).
   * Without effort the high-pass still runs, so that a ramp starts without
   * a step.
   */
  #tilt(voiced, dt, effort) {
    if (dt !== this.tiltStep) {
      this.tiltStep = dt;
      this.tiltPole = 1 / (1 + 2 * Math.PI * TILT_CORNER * dt);
    }
    const pole = this.tiltPole;
    const middle = pole * (this.tiltMiddle + voiced - this.tiltInput);
    this.tiltOutput = pole * (this.tiltOutput + middle - this.tiltMiddle);
    this.tiltInput = voiced;
    this.tiltMiddle = middle;
    return effort === 0
      ? voiced
      : voiced + (this.tiltGain - 1) * this.tiltOutput;
  }

  /**
   * Factor that brings the aspiration of an open tract to the noise rule of
   * the effort, `10^(0.5 E/20)`: the given lung pressure already carries
   * the effort (`2^(E/9)`), the pressure from the loudness does not.
   */
  #noiseGain(control) {
    const effort = control.effort ?? 0;
    if (effort === 0) {
      return 1;
    }
    return control.lungPressure === undefined
      ? 10 ** (effort / 40)
      : effortNoiseGain(effort);
  }

  #startPeriod(frequency, tenseness, creak, harsh) {
    // Small cycle-to-cycle irregularities make the voice sound natural;
    // creak and harsh voice make them larger.
    const source = PHONATION_SOURCE;
    const jitterDepth =
      this.jitterDepth +
      0.01 * (source.creakJitter * creak + source.harshJitter * harsh);
    const shimmerDepth = this.shimmerDepth + 0.01 * source.harshShimmer * harsh;
    this.jitter = 1 + jitterDepth * randomNormal(this.random);
    this.shimmer = 1 + shimmerDepth * randomNormal(this.random);
    this.period = 1 / Math.max(MIN_F0, frequency * this.jitter);
    // Double pulsing: every second period of a creak is longer and weaker.
    // Both periods shrink by half the lengthening, so that a pair lasts two
    // periods of the lowered f0.
    this.parity = 1 - this.parity;
    this.pulseGain = 1;
    if (creak > 0) {
      const lengthening = source.creakPulseLength * creak;
      this.period /= 1 + lengthening / 2;
      if (this.parity === 1) {
        this.period *= 1 + lengthening;
        this.pulseGain = 1 - source.creakPulseGain * creak;
      }
    }
    this.pulse = lfParameters(tenseness, this.breathiness, this.rdSlope);
  }

  /**
   * Relative turbulence strength at the glottis under an open tract, for a
   * control without `aspirationStrength` (cached: the inputs change at the
   * control rate).
   */
  #openTractStrength(control) {
    const lung =
      10 *
      (control.lungPressure ??
        this.lungPressure * Math.max(0, control.loudness) ** (2 / 3));
    const area = glottalArea(
      control,
      noiseBreathiness(this.breathiness, control.breath ?? 0),
      this.chink,
      this.areas
    );
    if (lung !== this.strengthKey[0] || area !== this.strengthKey[1]) {
      this.strengthKey[0] = lung;
      this.strengthKey[1] = area;
      this.strength = openTractStrength(lung, area, this.reCritical);
    }
    return this.strength;
  }

  /**
   * Turbulence strength at the glottis from the open tract and the lung
   * pressure, times whisperQuiet() in a whisper (src/acoustics/whisper.js).
   */
  #tractStrength(control, whisper) {
    const strength =
      this.#openTractStrength(control) * this.#noiseGain(control);
    return whisper > 0
      ? strength * whisperQuiet(whisper, control.effort ?? 0)
      : strength;
  }

  /**
   * Advance the pulse phase by `dt`, and start the next period (at the f0
   * of the phonation channels) when it passes the end of this one.
   */
  #advance(dt, f0, tenseness, creak, falsetto, harsh) {
    this.phase += dt;
    if (this.phase >= this.period) {
      this.phase -= this.period;
      this.#startPeriod(
        phonationF0(f0, creak, falsetto),
        tenseness,
        creak,
        harsh
      );
    }
  }

  /**
   * The intensity of the pulses with the falsetto level and the voiced
   * gain of the effort (`effort` dB).
   */
  #intensityGain(intensity, falsetto, effort) {
    let gained = intensity;
    if (falsetto !== 0) {
      gained *= 10 ** ((PHONATION_SOURCE.falsettoDecibels * falsetto) / 20);
    }
    if (effort !== 0) {
      this.#effortGains(effort);
      gained *= this.effortGain;
    }
    return gained;
  }

  /**
   * The LF pulse at phase `t` times the intensity, smoothed by the chink
   * and, in falsetto, by the thin folds (before the effort tilt).
   */
  #voicedSample(t, tenseness, dt, falsetto) {
    let voiced =
      lfWaveform(this.pulse, t) * this.intensity * (0.7 + 0.3 * tenseness);
    if (this.chinkTime > 0) {
      this.smoothed +=
        (1 - Math.exp(-dt / this.chinkTime)) * (voiced - this.smoothed);
      voiced = this.smoothed;
    }
    if (falsetto > 0) {
      // Thin folds: a one-pole low-pass at falsettoCorner * f0 / falsetto.
      const corner =
        (PHONATION_SOURCE.falsettoCorner * (1 / this.period)) / falsetto;
      this.falsettoSmoothed +=
        (1 - Math.exp(-2 * Math.PI * corner * dt)) *
        (voiced - this.falsettoSmoothed);
      return this.falsettoSmoothed;
    }
    this.falsettoSmoothed = voiced;
    return voiced;
  }

  /**
   * Advance by dt seconds and return the flow derivative sample.
   * @param {number} dt
   * @param {{f0: number, voicing: number, aspiration: number, closure: number, loudness: number, lungPressure?: number, aspirationStrength?: number, oralPressure?: number, effort?: number, tension?: number, breath?: number, creak?: number, falsetto?: number, harsh?: number}} control
   *   `aspirationStrength` is the relative turbulence strength at the
   *   glottis from the air flow (VoiceRenderer); without it the glottis
   *   assumes an open tract at `lungPressure` (Pa, default the head value
   *   times loudness^(2/3)). `oralPressure` (dyn/cm²) is the pressure in
   *   the mouth; the LF source does not use it. `effort` (dB, default 0)
   *   multiplies the voiced part by `10^(E/20)` and `tension` is added to
   *   the tenseness (src/articulation/effort.js). The phonation channels
   *   (0..1, default 0; src/articulation/phonation.js) change the source
   *   as PHONATION_SOURCE describes: `breath` (and `harsh`) add breath
   *   noise and glottal area, `creak` and `falsetto` shift f0. `whisper`
   *   (0..1, issue 53) multiplies the voiced part by `1 - whisper` (the
   *   pulse phase stands still at 1) and adds the whisper noise of
   *   src/acoustics/whisper.js: `whisperNoise` is its noise sample (else
   *   `noise`), `stopClosure` (0..1) the closure of the mouth and
   *   `fricative` (0..1) its frication.
   * @param {number} noise White noise sample in [-1, 1].
   */
  step(dt, control, noise) {
    const whisper = Math.min(1, Math.max(0, control.whisper ?? 0));
    const voicedShare = 1 - whisper;
    const voicing = Math.max(0, control.voicing) * (1 - control.closure);
    const loudness = Math.max(0, control.loudness);
    const tension = control.tension ?? 0;
    const base =
      tension === 0
        ? this.tenseness
        : Math.min(1, Math.max(0, this.tenseness + tension));
    const tenseness = Math.max(0, base - 0.5 * control.aspiration * voicing);
    const creak = control.creak ?? 0;
    const falsetto = control.falsetto ?? 0;
    const harsh = control.harsh ?? 0;
    if (voicedShare > 0) {
      this.#advance(dt, control.f0, tenseness, creak, falsetto, harsh);
    }
    const t = this.phase / this.period;
    const effort = control.effort ?? 0;
    this.intensity = this.#intensityGain(
      voicing * loudness * this.shimmer * this.pulseGain * voicedShare,
      falsetto,
      effort
    );
    const voiced = this.#tilt(
      this.#voicedSample(t, tenseness, dt, falsetto),
      dt,
      effort
    );
    // Aspiration is strongest while the folds are open.
    const opening = Math.max(0, Math.sin(2 * Math.PI * t));
    const modulation =
      (voicing > 0.1 ? 0.3 + 0.7 * opening * Math.min(1, voicing) : 1) *
        voicedShare +
      whisper;
    this.noiseModulation = modulation;
    // The lung pressure carries the loudness: the strength grows as the
    // pressure drop to the power 1.5, and the pressure as loudness^(2/3).
    const strength =
      control.aspirationStrength ?? this.#tractStrength(control, whisper);
    const breathiness = noiseBreathiness(
      this.breathiness,
      control.breath ?? 0,
      harsh
    );
    const breath =
      ((control.aspiration +
        this.breathGain *
          breathiness ** this.breathExponent *
          voicing *
          voicedShare) *
        (1 - control.closure) +
        (this.chinkNoise * this.chink) / 10) *
      strength;
    if (whisper > 0) {
      // The whisper noise: turbulence at the half-open glottis, not
      // modulated by pulses (src/acoustics/whisper.js).
      const whispered = whisperNoise(
        control,
        control.whisperNoise ?? noise,
        strength,
        this.pitch
      );
      return (
        voiced +
        (noise * breath * modulation + whispered) * 0.45 * this.aspirationLevel
      );
    }
    return voiced + noise * breath * modulation * 0.45 * this.aspirationLevel;
  }
}
