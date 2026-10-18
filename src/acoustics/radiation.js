/**
 * Sound radiation from the lips and nostrils for the 1D waveguide: the
 * reflection of a pressure wave at the open end of a tube of area A.
 *
 * The load is Flanagan's piston in a baffle, a resistance
 * R = 128 / (9 pi^2) in parallel with an inertance L = 8 a / (3 pi c)
 * (a = sqrt(A / pi), both relative to the tube impedance rho c / A), so
 *
 *   r(s) = (s L (R - 1) - R) / (s L (R + 1) + R)
 *
 * is -1 at low frequencies, where an opening that is small against the
 * wavelength reflects almost everything, and (R - 1) / (R + 1) = 0.18 at
 * high ones. A narrow opening (rounded lips, /u/) therefore keeps sharp
 * low formants and a wide one (/a/) radiates more. The bilinear transform
 * at the waveguide step rate turns r(s) into a first-order filter, which
 * stays passive (|r| <= 1) and stable for every area.
 */

import { SPEED_OF_SOUND } from './transfer.js';

/** Radiation resistance relative to rho c / A. */
export const RADIATION_RESISTANCE = 128 / (9 * Math.PI ** 2);

export class Radiation {
  constructor() {
    this.b0 = -1;
    this.b1 = 0;
    this.a1 = 0;
    this.input = 0;
    this.output = 0;
  }

  /**
   * Set the opening area (cm²) and the step rate (steps per second).
   * @param {number} area
   * @param {number} rate
   */
  configure(area, rate) {
    const radius = Math.sqrt(Math.max(area, 0) / Math.PI);
    const inertance = (8 * radius) / (3 * Math.PI * SPEED_OF_SOUND);
    const k = 2 * rate * inertance;
    const r = RADIATION_RESISTANCE;
    const scale = k * (r + 1) + r;
    this.b0 = (k * (r - 1) - r) / scale;
    this.b1 = -(k * (r - 1) + r) / scale;
    this.a1 = -(k * (r + 1) - r) / scale;
  }

  /**
   * Reflected wave for an incident one.
   * @param {number} incident
   */
  process(incident) {
    const reflected =
      this.b0 * incident + this.b1 * this.input - this.a1 * this.output;
    this.input = incident;
    this.output = reflected;
    return reflected;
  }

  /**
   * Reflection coefficient at a frequency (Hz) for the configured filter.
   * @param {number} frequency
   * @param {number} rate Step rate the filter was configured for.
   * @returns {{re: number, im: number}}
   */
  response(frequency, rate) {
    const w = (2 * Math.PI * frequency) / rate;
    // z^-1 = cos w - j sin w
    const numRe = this.b0 + this.b1 * Math.cos(w);
    const numIm = -this.b1 * Math.sin(w);
    const denRe = 1 + this.a1 * Math.cos(w);
    const denIm = -this.a1 * Math.sin(w);
    const scale = denRe * denRe + denIm * denIm;
    return {
      re: (numRe * denRe + numIm * denIm) / scale,
      im: (numIm * denRe - numRe * denIm) / scale,
    };
  }

  reset() {
    this.input = 0;
    this.output = 0;
  }
}
