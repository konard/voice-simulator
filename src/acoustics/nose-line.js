/**
 * A 1D Kelly-Lochbaum line hanging off a tract solver: the nasal tract, or
 * a blind side branch (piriform fossae, vallecula).
 *
 * Every section is one step of delay. Waves are pressure waves; the line
 * scatters at its internal junctions with the one-multiply form, and its
 * far end either radiates (the nostrils, see radiation.js) or is rigid
 * (a closed pouch). Section 0 is the port: its area is the opening into
 * the tract (for the nose the velopharyngeal port, see setPort), so the
 * flow that enters the line at the port is the flow that travels on.
 *
 * The owner couples the port: it reads `left[0]`, the wave arriving at the
 * port, and writes `junctionRight[0]`, the wave leaving it into section 0.
 * The waveguide does that with its three-port velum junction, the 2D sheet
 * (fdtd2d.js) with the pressure of the column the line hangs off. The flow
 * into the line is then (junctionRight[0] - left[0]) * areas[0], in the
 * waveguide's normalised units (pressure times area).
 *
 * The walls lose `wallLoss` times (for the nose also `nasalLoss` times)
 * more than lossFactor's smooth round tube, per section of length
 * restLength / LOSS_REFERENCE_SECTIONS raised to `lossExponent`.
 */

import { Radiation } from './radiation.js';
const MIN_AREA = 1e-4;

/**
 * Attenuation of a reference section (length / LOSS_REFERENCE_SECTIONS):
 * boundary-layer losses grow with perimeter / area, and the flow
 * resistance of narrow constrictions (Bernoulli/kinetic losses) dominates
 * below a few tenths of a cm². The kinetic term matches the resistance
 * rho U / A² of a steady flow U of about 150 cm³/s: a 1.5 cm long 0.15 cm²
 * constriction (/u/) loses U / (2 A c), about 1.5 % of the wave amplitude,
 * so the low formants of rounded and close vowels stay sharp.
 */
export function lossFactor(area, wall = 1) {
  const boundary = 0.0004 / Math.sqrt(Math.max(area, 0.05));
  const constriction = Math.min(0.3, 0.0001 / Math.max(area, 1e-3) ** 2);
  return 1 - 0.0007 * wall - boundary * wall - constriction;
}

export class NoseLine {
  /**
   * @param {{sections?: number, wallLoss?: number, lossExponent?: number, closed?: boolean, area?: number}} [options]
   *   `closed` gives a rigid far end (a blind pouch), otherwise it
   *   radiates; `area` gives every section that area (a uniform branch).
   */
  constructor(options = {}) {
    const n = Math.max(2, options.sections ?? 28);
    this.n = n;
    this.wallLoss = options.wallLoss ?? 1;
    this.lossExponent = options.lossExponent ?? 1;
    this.closed = options.closed === true;
    this.radiation = new Radiation();
    this.right = new Float64Array(n);
    this.left = new Float64Array(n);
    this.junctionRight = new Float64Array(n + 1);
    this.junctionLeft = new Float64Array(n + 1);
    this.areas = new Float64Array(n).fill(1);
    /** Profile from setProfile; section 0 is replaced by the port. */
    this.profile = new Float64Array(n).fill(1);
    this.reflection = new Float64Array(n + 1);
    this.damping = new Float64Array(n).fill(this.#loss(1));
    this.portArea = 0;
    this.rate = 1;
    this.output = 0;
    if (options.area !== undefined) {
      this.setProfile([options.area, options.area]);
    }
    this.setPort(options.area ?? 0);
  }

  #loss(area) {
    return Math.max(0, lossFactor(area, this.wallLoss)) ** this.lossExponent;
  }

  /**
   * Cross-sections along the line (resampled to the sections). Section 0
   * is the port and takes the area of setPort instead.
   * @param {ArrayLike<number>} areas
   */
  setProfile(areas) {
    const { n } = this;
    for (let index = 0; index < n; index++) {
      const position = (index / (n - 1)) * (areas.length - 1);
      const lower = Math.floor(position);
      const upper = Math.min(areas.length - 1, lower + 1);
      const fraction = position - lower;
      const area = areas[lower] * (1 - fraction) + areas[upper] * fraction;
      this.profile[index] = Math.max(MIN_AREA, area);
    }
    for (let index = 1; index < n; index++) {
      const area = this.profile[index];
      this.areas[index] = area;
      this.damping[index] = this.#loss(area);
    }
    for (let index = 2; index < n; index++) {
      const a = this.areas[index - 1];
      const b = this.areas[index];
      this.reflection[index] = (a - b) / (a + b);
    }
    this.setPort(this.portArea);
    this.configure(this.rate);
  }

  /**
   * Area of the port (section 0), cm²; a port wider than section 1 is
   * allowed.
   * @param {number} area
   */
  setPort(area) {
    this.portArea = Math.max(0, area);
    const port = Math.max(MIN_AREA, this.portArea);
    this.areas[0] = port;
    this.damping[0] = this.#loss(port);
    const next = this.areas[1];
    this.reflection[1] = (port - next) / (port + next);
  }

  /** Whether the port is open (wider than the minimum area). */
  get open() {
    return this.portArea > MIN_AREA;
  }

  /**
   * Step rate (steps per second of physical time), for the radiation
   * filter at the far end.
   * @param {number} rate
   */
  configure(rate) {
    this.rate = rate;
    if (!this.closed) {
      this.radiation.configure(this.areas[this.n - 1], rate);
    }
  }

  /** Scatter at the internal junctions and the far end. */
  scatter() {
    const { right, left, reflection, junctionRight, junctionLeft } = this;
    for (let index = 1; index < this.n; index++) {
      const incomingRight = right[index - 1];
      const incomingLeft = left[index];
      const w = reflection[index] * (incomingRight - incomingLeft);
      junctionRight[index] = incomingRight + w;
      junctionLeft[index] = incomingLeft + w;
    }
    const last = this.n - 1;
    if (this.closed) {
      junctionLeft[this.n] = right[last];
      this.output = 0;
      return;
    }
    const reflected = this.radiation.process(right[last]);
    junctionLeft[this.n] = reflected;
    this.output = (right[last] - reflected) * this.areas[last];
  }

  /** Move the waves one section on. */
  propagate() {
    const { right, left, junctionRight, junctionLeft, damping } = this;
    for (let index = 0; index < this.n; index++) {
      right[index] = junctionRight[index] * damping[index];
      left[index] = junctionLeft[index + 1] * damping[index];
    }
  }

  /**
   * Pressure per section (sum of both travelling waves).
   * @param {Float64Array} target
   */
  pressure(target) {
    for (let index = 0; index < this.n; index++) {
      target[index] = this.right[index] + this.left[index];
    }
    return target;
  }

  reset() {
    this.right.fill(0);
    this.left.fill(0);
    this.junctionRight.fill(0);
    this.junctionLeft.fill(0);
    this.output = 0;
    this.radiation.reset();
  }
}
