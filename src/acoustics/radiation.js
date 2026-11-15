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
 *
 * The face around the lips is a small, curved baffle, between a piston in
 * an infinite baffle (`baffle` 1) and the open end of a free pipe
 * (`baffle` 0), which radiates half the power and has the shorter end
 * correction 0.61 a (Levine & Schwinger 1948): the radiation resistance
 * at low frequencies, (k a)^2 / 2 for the piston, scales by
 * 0.5 + 0.5 baffle and the end correction is (0.61 + 0.24 baffle) a. In
 * the parallel R-L load that resistance is (w L)^2 / R, so R scales by
 * (end correction / 0.85)^2 / (0.5 + 0.5 baffle); scaling R itself by
 * 0.5 + 0.5 baffle would make a free pipe radiate more, not less.
 */

import { SPEED_OF_SOUND } from './constants.js';

/** Radiation resistance relative to rho c / A. */
export const RADIATION_RESISTANCE = 128 / (9 * Math.PI ** 2);

/**
 * How much of an infinite baffle the face is (0.3-1): calibrated with
 * experiments/issue-11-bandwidths.mjs (issue 36), where 0.3-0.7 fit
 * equally well (mean bandwidth error 23.6-23.8 %) and 0.5, half a baffle,
 * is the middle.
 */
export const RADIATION_BAFFLE = 0.5;

/**
 * Radiation resistance (relative to rho c / A) and end correction (in
 * radii) of an opening in a baffle of `baffle` (0 free pipe, 1 infinite).
 * @param {number} [baffle]
 */
export function radiationLoad(baffle = RADIATION_BAFFLE) {
  const endCorrection = 0.61 + 0.24 * baffle;
  return {
    resistance:
      (RADIATION_RESISTANCE * (endCorrection / 0.85) ** 2) /
      (0.5 + 0.5 * baffle),
    endCorrection,
  };
}

export class Radiation {
  constructor() {
    this.b0 = -1;
    this.b1 = 0;
    this.a1 = 0;
    this.input = 0;
    this.output = 0;
  }

  /**
   * Set the opening area (cm²), the step rate (steps per second) and the
   * baffle (0 free pipe end, 1 infinite baffle).
   * @param {number} area
   * @param {number} rate
   * @param {number} [baffle]
   */
  configure(area, rate, baffle = 1) {
    const radius = Math.sqrt(Math.max(area, 0) / Math.PI);
    const { resistance, endCorrection } = radiationLoad(baffle);
    const inertance = (endCorrection * radius) / SPEED_OF_SOUND;
    const k = 2 * rate * inertance;
    const r = resistance;
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
