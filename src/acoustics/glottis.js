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
 * LF pulse parameters for a tenseness value (0 = breathy/lax, 1 = pressed).
 * The pulse is normalised to period 1 and a negative peak of about -1.
 * @param {number} tenseness
 */
export function lfParameters(tenseness) {
  const rd = Math.min(2.7, Math.max(0.5, 3 * (1 - tenseness)));
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
  return { alpha, e0, epsilon, shift, delta, te, omega };
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
   * @param {{seed?: string|number, tenseness?: number, breathiness?: number, jitter?: number, shimmer?: number, aspirationLevel?: number, chink?: number}} [options]
   *   `jitter` and `shimmer` are standard deviations in percent, `chink`
   *   the area of the glottal chink in mm².
   */
  constructor(options = {}) {
    this.random = createRandom(`${options.seed ?? 1}:glottis`);
    this.tenseness = options.tenseness ?? 0.6;
    this.breathiness = options.breathiness ?? 0.2;
    this.jitterDepth = 0.01 * (options.jitter ?? 0.4);
    this.shimmerDepth = 0.01 * (options.shimmer ?? 3);
    this.aspirationLevel = options.aspirationLevel ?? 1;
    this.chinkTime = chinkTimeConstant(options.chink ?? 0);
    this.smoothed = 0;
    this.phase = 0;
    this.period = 1 / 120;
    this.jitter = 1;
    this.shimmer = 1;
    this.intensity = 0;
    this.pulse = lfParameters(this.tenseness);
    this.noiseModulation = 0;
  }

  #startPeriod(frequency, tenseness) {
    // Small cycle-to-cycle irregularities make the voice sound natural.
    this.jitter = 1 + this.jitterDepth * randomNormal(this.random);
    this.shimmer = 1 + this.shimmerDepth * randomNormal(this.random);
    this.period = 1 / Math.max(30, frequency * this.jitter);
    this.pulse = lfParameters(tenseness);
  }

  /**
   * Advance by dt seconds and return the flow derivative sample.
   * @param {number} dt
   * @param {{f0: number, voicing: number, aspiration: number, closure: number, loudness: number}} control
   * @param {number} noise White noise sample in [-1, 1].
   */
  step(dt, control, noise) {
    const voicing = Math.max(0, control.voicing) * (1 - control.closure);
    const loudness = Math.max(0, control.loudness);
    const tenseness = Math.max(
      0,
      this.tenseness - 0.5 * control.aspiration * voicing
    );
    this.phase += dt;
    if (this.phase >= this.period) {
      this.phase -= this.period;
      this.#startPeriod(control.f0, tenseness);
    }
    const t = this.phase / this.period;
    this.intensity = voicing * loudness * this.shimmer;
    let voiced =
      lfWaveform(this.pulse, t) * this.intensity * (0.7 + 0.3 * tenseness);
    if (this.chinkTime > 0) {
      this.smoothed +=
        (1 - Math.exp(-dt / this.chinkTime)) * (voiced - this.smoothed);
      voiced = this.smoothed;
    }
    // Aspiration is strongest while the folds are open.
    const opening = Math.max(0, Math.sin(2 * Math.PI * t));
    const modulation =
      voicing > 0.1 ? 0.3 + 0.7 * opening * Math.min(1, voicing) : 1;
    this.noiseModulation = modulation;
    const breath =
      (control.aspiration + this.breathiness * voicing * 0.35) *
      (1 - control.closure);
    return (
      voiced +
      noise * breath * modulation * loudness * 0.45 * this.aspirationLevel
    );
  }
}
