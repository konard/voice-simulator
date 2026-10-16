/**
 * Vocal fold source: Liljencrants-Fant (LF) glottal flow derivative with
 * the one-parameter Rd shaping of Fant (1995), plus aspiration noise that
 * is modulated by the glottal opening. The parametrisation follows the
 * well known Pink Trombone glottis (Neil Thapen, MIT licence).
 */

import { randomNormal, createRandom } from '../random.js';

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
   * @param {{seed?: string|number, tenseness?: number, breathiness?: number}} [options]
   */
  constructor(options = {}) {
    this.random = createRandom(`${options.seed ?? 1}:glottis`);
    this.tenseness = options.tenseness ?? 0.6;
    this.breathiness = options.breathiness ?? 0.2;
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
    this.jitter = 1 + 0.004 * randomNormal(this.random);
    this.shimmer = 1 + 0.03 * randomNormal(this.random);
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
    const voiced =
      lfWaveform(this.pulse, t) * this.intensity * (0.7 + 0.3 * tenseness);
    // Aspiration is strongest while the folds are open.
    const opening = Math.max(0, Math.sin(2 * Math.PI * t));
    const modulation =
      voicing > 0.1 ? 0.3 + 0.7 * opening * Math.min(1, voicing) : 1;
    this.noiseModulation = modulation;
    const breath =
      (control.aspiration + this.breathiness * voicing * 0.35) *
      (1 - control.closure);
    return voiced + noise * breath * modulation * loudness * 0.45;
  }
}
