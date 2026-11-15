/**
 * 1D digital waveguide (Kelly-Lochbaum) model of the vocal and nasal tracts.
 *
 * Every section is one sample of delay, so the step rate is
 * sections * c / length: a longer tract simply runs slower. Waves are
 * pressure waves; junctions use the one-multiply scattering form and the
 * velum is a three-port junction. The glottis injects volume velocity,
 * and the output is the volume velocity leaving lips and nostrils, which
 * (with a flow-derivative source) is proportional to the radiated sound.
 * Lips and nostrils reflect according to their opening area (see
 * radiation.js), and the losses are given per reference section of
 * length / LOSS_REFERENCE_SECTIONS, so they do not depend on the number
 * of sections.
 *
 * Nose section 0 is the velopharyngeal port: it takes the port area, so
 * the three-port junction at the velum and the nose conserve volume flow
 * (issue 84). The nose walls lose `nasalLoss` times more than a smooth
 * round tube of the same area: the septum and the turbinates give the
 * nasal cavity several times the wetted perimeter of a circle, and the
 * mucosa is soft (Dang, Honda & Suzuki 1994).
 *
 * The piriform fossae, two blind pouches either side of the larynx tube,
 * hang off the lower pharynx as one closed side branch about 2 cm long.
 * Their quarter-wave resonance puts an antiresonance near 4-5 kHz into
 * every vowel (Dang & Honda 1997; Takemoto et al. 2010).
 */

import { glottalReflection } from './glottis.js';
import { NoseLine, lossFactor } from './nose-line.js';
import { Radiation } from './radiation.js';
import { SPEED_OF_SOUND } from './transfer.js';
import { DEFAULT_HEAD } from '../head-config.js';

const MIN_AREA = 1e-4;
/** Sections over which lossFactor gives the attenuation of one section. */
export const LOSS_REFERENCE_SECTIONS = 44;
/** Piriform fossae: depth (cm), combined opening (cm²), height (cm). */
export const PIRIFORM_LENGTH = 2;
export const PIRIFORM_AREA = 0.5;
export const PIRIFORM_HEIGHT = 2.4;
export const REST_LENGTH = 16.5;
export { lossFactor };

/**
 * The piriform side branch the waveguide builds: junction section, opening
 * (cm²), number of sections and depth (cm) for a tract of `length` cm, in
 * the form tubeTransfer takes for a branch.
 * @param {number} sections
 * @param {number} length Tract length (cm).
 * @param {{vocalTractLength?: number, pharynxWidth?: number}} [head]
 */
export function piriformBranch(sections, length, head = {}) {
  const rest = head.vocalTractLength ?? REST_LENGTH;
  const count = Math.max(2, Math.round((sections * PIRIFORM_LENGTH) / rest));
  return {
    index: Math.max(1, Math.round((sections * PIRIFORM_HEIGHT) / rest)),
    area: PIRIFORM_AREA * (head.pharynxWidth ?? 1),
    sections: count,
    length: (count * length) / sections,
  };
}

export class Waveguide {
  /**
   * `piriform: false` leaves out the piriform fossae side branch.
   * @param {{sections?: number, noseSections?: number, head?: {wallLoss?: number, nasalLoss?: number}, piriform?: boolean}} [options]
   */
  constructor(options = {}) {
    const n = options.sections ?? 44;
    const nose = options.noseSections ?? 28;
    /** Scale of the boundary (wall and viscous) losses. */
    this.wallLoss = options.head?.wallLoss ?? 1;
    /** Extra boundary losses of the nose relative to a round tube. */
    this.nasalLoss = options.head?.nasalLoss ?? DEFAULT_HEAD.nasalLoss;
    this.glottalReflection = glottalReflection(options.head);
    this.n = n;
    this.noseN = nose;
    /** Exponent that turns lossFactor into the attenuation of a section. */
    this.lossExponent = LOSS_REFERENCE_SECTIONS / n;
    this.lips = new Radiation();
    this.right = new Float64Array(n);
    this.left = new Float64Array(n);
    this.junctionRight = new Float64Array(n + 1);
    this.junctionLeft = new Float64Array(n + 1);
    this.areas = new Float64Array(n).fill(1);
    this.reflection = new Float64Array(n + 1);
    this.damping = new Float64Array(n).fill(this.#loss(1));
    /** Nasal tract; its section 0 is the velopharyngeal port. */
    this.nose = new NoseLine({
      sections: nose,
      wallLoss: this.wallLoss * this.nasalLoss,
      lossExponent: this.lossExponent,
    });
    this.velumArea = 0;
    this.velumIndex = Math.round(n * 0.45);
    this.lipOutput = 0;
    this.#allocatePiriform(options);
    this.setLength(options.head?.vocalTractLength ?? REST_LENGTH);
  }

  #loss(area) {
    return Math.max(0, lossFactor(area, this.wallLoss)) ** this.lossExponent;
  }

  /** Volume velocity leaving the nostrils at the last step. */
  get noseOutput() {
    return this.nose.output;
  }

  /**
   * Tract length (cm), which sets the step rate n c / length and with it
   * the radiation filters of lips and nostrils.
   * @param {number} length
   */
  setLength(length) {
    this.length = length;
    this.rate = (this.n * SPEED_OF_SOUND) / length;
    this.lips.configure(this.areas[this.n - 1], this.rate);
    this.nose.configure(this.rate);
  }

  #allocatePiriform(options) {
    const enabled = options.piriform !== false;
    const branch = piriformBranch(this.n, REST_LENGTH, options.head);
    const count = enabled ? branch.sections : 0;
    this.piriform = {
      index: branch.index,
      area: branch.area,
      right: new Float64Array(count),
      left: new Float64Array(count),
      damping: this.#loss(PIRIFORM_AREA / 2),
      entering: 0,
    };
  }

  /**
   * Set the nasal tract cross-sections (they do not move during speech).
   * Section 0 is the velopharyngeal port and takes the port area of
   * setShape instead.
   * @param {ArrayLike<number>} areas
   */
  setNose(areas) {
    this.nose.setProfile(areas);
  }

  /**
   * Update the oral tract (areas must have `sections` entries).
   * @param {ArrayLike<number>} areas
   * @param {number} velumArea cm² of the velopharyngeal port.
   * @param {number} [velumIndex]
   */
  setShape(areas, velumArea, velumIndex = this.velumIndex) {
    for (let index = 0; index < this.n; index++) {
      const area = Math.max(MIN_AREA, areas[index]);
      this.areas[index] = area;
      this.damping[index] = this.#loss(area);
    }
    for (let index = 1; index < this.n; index++) {
      const a = this.areas[index - 1];
      const b = this.areas[index];
      this.reflection[index] = (a - b) / (a + b);
    }
    this.velumArea = Math.max(0, velumArea);
    this.velumIndex = Math.min(this.n - 2, Math.max(1, velumIndex));
    this.nose.setPort(this.velumArea);
    this.lips.configure(this.areas[this.n - 1], this.rate);
  }

  #scatterOral() {
    const { right, left, reflection, junctionRight, junctionLeft } = this;
    for (let index = 1; index < this.n; index++) {
      const incomingRight = right[index - 1];
      const incomingLeft = left[index];
      const w = reflection[index] * (incomingRight - incomingLeft);
      junctionRight[index] = incomingRight + w;
      junctionLeft[index] = incomingLeft + w;
    }
  }

  /** Three-port junction between pharynx, oral cavity and nose. */
  #scatterVelum() {
    const index = this.velumIndex;
    const a = this.areas[index - 1];
    const b = this.areas[index];
    const c = this.velumArea;
    if (c <= MIN_AREA) {
      this.nose.junctionRight[0] = this.nose.left[0];
      return;
    }
    const fromLeft = this.right[index - 1];
    const fromRight = this.left[index];
    const fromNose = this.nose.left[0];
    const pressure =
      (2 * (a * fromLeft + b * fromRight + c * fromNose)) / (a + b + c);
    this.junctionRight[index] = pressure - fromRight;
    this.junctionLeft[index] = pressure - fromLeft;
    this.nose.junctionRight[0] = pressure - fromNose;
  }

  /** Three-port junction into the closed piriform branch. */
  #scatterPiriform() {
    const { index, area, right, left } = this.piriform;
    if (!right.length || index === this.velumIndex) {
      return;
    }
    const a = this.areas[index - 1];
    const b = this.areas[index];
    const fromLeft = this.right[index - 1];
    const fromRight = this.left[index];
    const fromSide = left[0];
    const pressure =
      (2 * (a * fromLeft + b * fromRight + area * fromSide)) / (a + b + area);
    this.junctionRight[index] = pressure - fromRight;
    this.junctionLeft[index] = pressure - fromLeft;
    this.piriform.entering = pressure - fromSide;
  }

  /** Uniform blind tube: plain delay with a rigid (+1) far end. */
  #propagatePiriform() {
    const { right, left, damping } = this.piriform;
    const last = right.length - 1;
    if (last < 0) {
      return;
    }
    const end = right[last];
    for (let index = 0; index < last; index++) {
      left[index] = left[index + 1] * damping;
    }
    left[last] = end * damping;
    for (let index = last; index > 0; index--) {
      right[index] = right[index - 1] * damping;
    }
    right[0] = this.piriform.entering * damping;
  }

  #propagate() {
    const { right, left, junctionRight, junctionLeft, damping } = this;
    for (let index = 0; index < this.n; index++) {
      right[index] = junctionRight[index] * damping[index];
      left[index] = junctionLeft[index + 1] * damping[index];
    }
    this.nose.propagate();
  }

  /**
   * Advance one step.
   * @param {number} glottalFlow Source volume velocity (derivative).
   * @param {number} noisePosition Junction index of the turbulence source.
   * @param {number} noise Turbulence pressure (a dipole source).
   * @param {number} [flow] Flow source (derivative) at the same junction:
   *   the burst transient of a stop (a monopole source).
   * @returns {number} Radiated output (lips + nose).
   */
  step(glottalFlow, noisePosition, noise, flow = 0) {
    this.junctionRight[0] =
      this.left[0] * this.glottalReflection + glottalFlow / this.areas[0];
    const last = this.n - 1;
    const reflected = this.lips.process(this.right[last]);
    this.junctionLeft[this.n] = reflected;
    this.lipOutput = (this.right[last] - reflected) * this.areas[last];
    this.#scatterOral();
    this.#scatterVelum();
    this.#scatterPiriform();
    this.nose.scatter();
    if (noise !== 0 || flow !== 0) {
      const position = Math.min(this.n - 1, Math.max(1, noisePosition));
      this.junctionRight[position] += (flow + noise) * 0.5;
      this.junctionLeft[position] += (flow - noise) * 0.5;
    }
    this.#propagatePiriform();
    this.#propagate();
    return this.lipOutput + this.noseOutput;
  }

  /**
   * Acoustic pressure per section (sum of both travelling waves), for
   * visualisation. Arrays are reused between calls.
   * @returns {{pressure: Float64Array, nose: Float64Array}}
   */
  field() {
    this.pressure ??= new Float64Array(this.n);
    this.nosePressure ??= new Float64Array(this.noseN);
    for (let index = 0; index < this.n; index++) {
      this.pressure[index] = this.right[index] + this.left[index];
    }
    this.nose.pressure(this.nosePressure);
    return { pressure: this.pressure, nose: this.nosePressure };
  }

  reset() {
    for (const array of [
      this.right,
      this.left,
      this.junctionRight,
      this.junctionLeft,
      this.piriform.right,
      this.piriform.left,
    ]) {
      array.fill(0);
    }
    this.piriform.entering = 0;
    this.lips.reset();
    this.nose.reset();
  }
}
