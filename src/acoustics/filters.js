/**
 * Small DSP building blocks: white noise and RBJ biquads.
 * Coefficients can be recomputed at any time, which the solvers use when
 * their internal step rate follows the current vocal tract length.
 */

import { createRandom } from '../random.js';

/**
 * Deterministic white noise in [-1, 1].
 * @param {string|number} [seed]
 * @returns {() => number}
 */
export function createNoise(seed = 1) {
  const random = createRandom(seed);
  return () => random() * 2 - 1;
}

export class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  setCoefficients(b0, b1, b2, a0, a1, a2) {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  #prepare(frequency, q, rate) {
    const omega = (2 * Math.PI * Math.min(frequency, rate * 0.49)) / rate;
    const alpha = Math.sin(omega) / (2 * q);
    return { cos: Math.cos(omega), alpha };
  }

  lowpass(frequency, q, rate) {
    const { cos, alpha } = this.#prepare(frequency, q, rate);
    return this.setCoefficients(
      (1 - cos) / 2,
      1 - cos,
      (1 - cos) / 2,
      1 + alpha,
      -2 * cos,
      1 - alpha
    );
  }

  highpass(frequency, q, rate) {
    const { cos, alpha } = this.#prepare(frequency, q, rate);
    return this.setCoefficients(
      (1 + cos) / 2,
      -(1 + cos),
      (1 + cos) / 2,
      1 + alpha,
      -2 * cos,
      1 - alpha
    );
  }

  bandpass(frequency, q, rate) {
    const { cos, alpha } = this.#prepare(frequency, q, rate);
    return this.setCoefficients(
      alpha,
      0,
      -alpha,
      1 + alpha,
      -2 * cos,
      1 - alpha
    );
  }

  process(input) {
    const output =
      this.b0 * input +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }

  reset() {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
}
