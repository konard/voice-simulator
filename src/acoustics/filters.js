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
  // The last two inputs, followed by the last two outputs.
  #history = new Float64Array(4);

  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
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
    const history = this.#history;
    const output =
      this.b0 * input +
      this.b1 * history[0] +
      this.b2 * history[1] -
      this.a1 * history[2] -
      this.a2 * history[3];
    history[1] = history[0];
    history[0] = input;
    history[3] = history[2];
    history[2] = output;
    return output;
  }

  reset() {
    this.#history.fill(0);
  }
}
