/**
 * 1D digital waveguide (Kelly-Lochbaum) model of the vocal and nasal tracts.
 *
 * Every section is one sample of delay, so the step rate is
 * sections * c / length: a longer tract simply runs slower. Waves are
 * pressure waves; junctions use the one-multiply scattering form and the
 * velum is a three-port junction. The glottis injects volume velocity,
 * and the output is the volume velocity leaving lips and nostrils, which
 * (with a flow-derivative source) is proportional to the radiated sound.
 */

const MIN_AREA = 1e-4;
const GLOTTAL_REFLECTION = 0.75;
const LIP_REFLECTION = -0.85;
const NOSTRIL_REFLECTION = -0.85;

/**
 * Per-step attenuation of a section: boundary-layer losses grow with
 * perimeter / area, and the flow resistance of narrow constrictions
 * (Bernoulli/kinetic losses) dominates below a few tenths of a cm².
 */
export function lossFactor(area, wall = 1) {
  const boundary = 0.0004 / Math.sqrt(Math.max(area, 0.05));
  const constriction = Math.min(0.3, 0.0004 / Math.max(area, 1e-3) ** 2);
  return 1 - 0.0007 * wall - boundary * wall - constriction;
}

export class Waveguide {
  /**
   * @param {{sections?: number, noseSections?: number, head?: {wallLoss?: number}}} [options]
   */
  constructor(options = {}) {
    const n = options.sections ?? 44;
    const nose = options.noseSections ?? 28;
    /** Scale of the boundary (wall and viscous) losses. */
    this.wallLoss = options.head?.wallLoss ?? 1;
    this.n = n;
    this.noseN = nose;
    this.right = new Float64Array(n);
    this.left = new Float64Array(n);
    this.junctionRight = new Float64Array(n + 1);
    this.junctionLeft = new Float64Array(n + 1);
    this.areas = new Float64Array(n).fill(1);
    this.reflection = new Float64Array(n + 1);
    this.damping = new Float64Array(n).fill(lossFactor(1, this.wallLoss));
    this.noseRight = new Float64Array(nose);
    this.noseLeft = new Float64Array(nose);
    this.noseJunctionRight = new Float64Array(nose + 1);
    this.noseJunctionLeft = new Float64Array(nose + 1);
    this.noseAreas = new Float64Array(nose).fill(1);
    this.noseReflection = new Float64Array(nose + 1);
    this.noseDamping = new Float64Array(nose).fill(
      lossFactor(1, this.wallLoss)
    );
    this.velumArea = 0;
    this.velumIndex = Math.round(n * 0.45);
    this.lipOutput = 0;
    this.noseOutput = 0;
  }

  /**
   * Set the nasal tract cross-sections (they do not move during speech).
   * @param {ArrayLike<number>} areas
   */
  setNose(areas) {
    for (let index = 0; index < this.noseN; index++) {
      const position = (index / (this.noseN - 1)) * (areas.length - 1);
      const lower = Math.floor(position);
      const upper = Math.min(areas.length - 1, lower + 1);
      const fraction = position - lower;
      const area = areas[lower] * (1 - fraction) + areas[upper] * fraction;
      this.noseAreas[index] = Math.max(MIN_AREA, area);
      this.noseDamping[index] = lossFactor(area, this.wallLoss);
    }
    for (let index = 1; index < this.noseN; index++) {
      const a = this.noseAreas[index - 1];
      const b = this.noseAreas[index];
      this.noseReflection[index] = (a - b) / (a + b);
    }
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
      this.damping[index] = lossFactor(area, this.wallLoss);
    }
    for (let index = 1; index < this.n; index++) {
      const a = this.areas[index - 1];
      const b = this.areas[index];
      this.reflection[index] = (a - b) / (a + b);
    }
    this.velumArea = Math.max(0, velumArea);
    this.velumIndex = Math.min(this.n - 2, Math.max(1, velumIndex));
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
      this.noseJunctionRight[0] = this.noseLeft[0];
      return;
    }
    const fromLeft = this.right[index - 1];
    const fromRight = this.left[index];
    const fromNose = this.noseLeft[0];
    const pressure =
      (2 * (a * fromLeft + b * fromRight + c * fromNose)) / (a + b + c);
    this.junctionRight[index] = pressure - fromRight;
    this.junctionLeft[index] = pressure - fromLeft;
    this.noseJunctionRight[0] = pressure - fromNose;
  }

  #scatterNose() {
    const { noseRight, noseLeft, noseReflection } = this;
    for (let index = 1; index < this.noseN; index++) {
      const incomingRight = noseRight[index - 1];
      const incomingLeft = noseLeft[index];
      const w = noseReflection[index] * (incomingRight - incomingLeft);
      this.noseJunctionRight[index] = incomingRight + w;
      this.noseJunctionLeft[index] = incomingLeft + w;
    }
    const last = this.noseN - 1;
    this.noseJunctionLeft[this.noseN] = noseRight[last] * NOSTRIL_REFLECTION;
    this.noseOutput =
      noseRight[last] * (1 - NOSTRIL_REFLECTION) * this.noseAreas[last];
  }

  #propagate() {
    const { right, left, junctionRight, junctionLeft, damping } = this;
    for (let index = 0; index < this.n; index++) {
      right[index] = junctionRight[index] * damping[index];
      left[index] = junctionLeft[index + 1] * damping[index];
    }
    const { noseRight, noseLeft, noseDamping } = this;
    for (let index = 0; index < this.noseN; index++) {
      noseRight[index] = this.noseJunctionRight[index] * noseDamping[index];
      noseLeft[index] = this.noseJunctionLeft[index + 1] * noseDamping[index];
    }
  }

  /**
   * Advance one step.
   * @param {number} glottalFlow Source volume velocity (derivative).
   * @param {number} noisePosition Junction index of the turbulence source.
   * @param {number} noise Turbulence pressure.
   * @returns {number} Radiated output (lips + nose).
   */
  step(glottalFlow, noisePosition, noise) {
    this.junctionRight[0] =
      this.left[0] * GLOTTAL_REFLECTION + glottalFlow / this.areas[0];
    const last = this.n - 1;
    this.junctionLeft[this.n] = this.right[last] * LIP_REFLECTION;
    this.lipOutput = this.right[last] * (1 - LIP_REFLECTION) * this.areas[last];
    this.#scatterOral();
    this.#scatterVelum();
    this.#scatterNose();
    if (noise !== 0) {
      const position = Math.min(this.n - 1, Math.max(1, noisePosition));
      this.junctionRight[position] += noise * 0.5;
      this.junctionLeft[position] -= noise * 0.5;
    }
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
    for (let index = 0; index < this.noseN; index++) {
      this.nosePressure[index] = this.noseRight[index] + this.noseLeft[index];
    }
    return { pressure: this.pressure, nose: this.nosePressure };
  }

  reset() {
    for (const array of [
      this.right,
      this.left,
      this.junctionRight,
      this.junctionLeft,
      this.noseRight,
      this.noseLeft,
      this.noseJunctionRight,
      this.noseJunctionLeft,
    ]) {
      array.fill(0);
    }
  }
}
