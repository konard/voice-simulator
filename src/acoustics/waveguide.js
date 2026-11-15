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
 * radiation.js).
 *
 * Losses (issue 36, losses.js): the tract is split into LOSS_STAGES
 * groups of sections (the nose into NOSE_LOSS_STAGES). At the end of each
 * group a first-order filter per travelling wave applies the viscous and
 * thermal boundary-layer loss of the whole group, which grows with
 * sqrt(f), and a mass-damper-spring wall branch takes the flow of the
 * yielding walls of the group out of the tract. The flow resistance of
 * narrow constrictions stays a per-section factor (lossFactor), given per
 * reference section of length / LOSS_REFERENCE_SECTIONS so that it does
 * not depend on the number of sections.
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
import { Radiation, RADIATION_BAFFLE } from './radiation.js';
import { AIR_DENSITY, SPEED_OF_SOUND } from './constants.js';
import {
  LOSS_SHAPE,
  LOSS_STAGES,
  NOSE_LOSS_STAGES,
  WALL_MASS,
  WALL_RESISTANCE,
  WALL_STIFFNESS,
  LOSS_REFERENCE_SECTIONS,
  constrictionLoss,
  designLossFilter,
  viscothermalLoss,
  wallSurface,
} from './losses.js';
import { DEFAULT_HEAD } from '../head-config.js';

const MIN_AREA = 1e-4;
export { LOSS_REFERENCE_SECTIONS };
/** Piriform fossae: depth (cm), combined opening (cm²), height (cm). */
export const PIRIFORM_LENGTH = 2;
export const PIRIFORM_AREA = 0.5;
export const PIRIFORM_HEIGHT = 2.4;
export const REST_LENGTH = 16.5;

/**
 * The piriform side branch the waveguide builds: junction section, opening
 * (cm²), number of sections, depth (cm) for a tract of `length` cm and
 * number of fossae sharing the opening, in the form tubeTransfer takes for
 * a branch.
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
    tubes: 2,
  };
}

/**
 * Attenuation of a reference section (length / LOSS_REFERENCE_SECTIONS)
 * by the flow resistance of narrow constrictions (constrictionLoss in
 * losses.js). The wall losses are frequency dependent (losses.js).
 * @param {number} area
 */
export function lossFactor(area) {
  return Math.exp(-constrictionLoss(area));
}

/**
 * Attenuation of a reference section with the constriction loss and a
 * boundary loss that does not depend on frequency, scaled by `wall`: the
 * waveguide loss before issue 36, which the 3D solver keeps.
 * @param {number} area
 * @param {number} [wall]
 */
export function boundaryLossFactor(area, wall = 1) {
  const boundary = 0.0004 / Math.sqrt(Math.max(area, 0.05));
  return lossFactor(area) - 0.0007 * wall - boundary * wall;
}

/**
 * Last section of each of `stages` groups of `sections` sections.
 * @param {number} sections
 * @param {number} stages
 */
function groupEnds(sections, stages) {
  const count = Math.max(1, Math.min(sections, Math.round(stages)));
  return Int32Array.from(
    { length: count },
    (_, group) => Math.round((sections * (group + 1)) / count) - 1
  );
}

/**
 * Loss filters (one per travelling wave) at the ends of groups of
 * sections; coefficients and states per group.
 */
function lossStages(sections, stages) {
  const ends = groupEnds(sections, stages);
  const filter = () => new Float64Array(ends.length);
  return {
    ends,
    b0: filter().fill(1),
    b1: filter(),
    a1: filter(),
    rightInput: filter(),
    rightOutput: filter(),
    leftInput: filter(),
    leftOutput: filter(),
  };
}

/** One step of a group's loss filter on `value`. */
function filterStage(stages, group, value, input, output) {
  const result =
    stages.b0[group] * value +
    stages.b1[group] * input[group] -
    stages.a1[group] * output[group];
  input[group] = value;
  output[group] = result;
  return result;
}

export class Waveguide {
  /**
   * `piriform: false` leaves out the piriform fossae side branch.
   * `lossShape`, `lossStages` and `baffle` replace LOSS_SHAPE,
   * LOSS_STAGES and RADIATION_BAFFLE (for calibration), and `walls: false`
   * makes the walls rigid.
   * @param {{sections?: number, noseSections?: number, head?: {wallLoss?: number, nasalLoss?: number, wallMass?: number, wallResistance?: number, wallStiffness?: number}, piriform?: boolean, lossShape?: number, lossStages?: number, baffle?: number, walls?: boolean}} [options]
   */
  constructor(options = {}) {
    const n = options.sections ?? 44;
    const nose = options.noseSections ?? 28;
    const head = options.head ?? {};
    /** Scale of the boundary (wall and viscous) losses. */
    this.wallLoss = head.wallLoss ?? 1;
    /** Boundary-layer loss relative to a smooth round tube. */
    this.lossShape = options.lossShape ?? LOSS_SHAPE;
    this.baffle = options.baffle ?? RADIATION_BAFFLE;
    this.stages = lossStages(n, options.lossStages ?? LOSS_STAGES);
    this.noseStages = lossStages(nose, NOSE_LOSS_STAGES);
    /** Yielding wall of each group: mass, resistance, stiffness per cm². */
    this.walls = options.walls !== false;
    this.wallMass = head.wallMass ?? WALL_MASS;
    this.wallResistance =
      (head.wallResistance ?? WALL_RESISTANCE) * this.wallLoss;
    this.wallStiffness = head.wallStiffness ?? WALL_STIFFNESS;
    const groups = this.stages.ends.length;
    this.wallJunction = new Int32Array(groups);
    this.wallSurface = new Float64Array(groups);
    this.wallFlow = new Float64Array(groups);
    this.wallVolume = new Float64Array(groups);
    /** Extra boundary losses of the nose relative to a round tube. */
    this.nasalLoss = options.head?.nasalLoss ?? DEFAULT_HEAD.nasalLoss;
    this.glottalReflection = glottalReflection(options.head);
    this.n = n;
    this.noseN = nose;
    /** Exponent that turns lossFactor into the attenuation of a section. */
    this.lossExponent = LOSS_REFERENCE_SECTIONS / n;
    this.lips = new Radiation();
    this.nostrils = new Radiation();
    this.right = new Float64Array(n);
    this.left = new Float64Array(n);
    this.junctionRight = new Float64Array(n + 1);
    this.junctionLeft = new Float64Array(n + 1);
    this.areas = new Float64Array(n).fill(1);
    this.reflection = new Float64Array(n + 1);
    this.damping = new Float64Array(n).fill(this.#loss(1));
    this.noseRight = new Float64Array(nose);
    this.noseLeft = new Float64Array(nose);
    this.noseJunctionRight = new Float64Array(nose + 1);
    this.noseJunctionLeft = new Float64Array(nose + 1);
    this.noseAreas = new Float64Array(nose).fill(1);
    /** Nose profile from setNose; section 0 is replaced by the port. */
    this.noseProfile = new Float64Array(nose).fill(1);
    this.noseReflection = new Float64Array(nose + 1);
    this.noseDamping = new Float64Array(nose).fill(this.#noseLoss(1));
    this.velumArea = 0;
    this.velumIndex = Math.round(n * 0.45);
    this.#applyPort();
    this.lipOutput = 0;
    this.noseOutput = 0;
    this.#allocatePiriform(options);
    this.setLength(options.head?.vocalTractLength ?? REST_LENGTH);
  }

  #loss(area) {
    return Math.max(0, lossFactor(area)) ** this.lossExponent;
  }

  #noseLoss(area) {
    return this.#loss(area);
  }

  /**
   * Tract length (cm), which sets the step rate n c / length and with it
   * the radiation filters of lips and nostrils and the loss filters.
   * @param {number} length
   */
  setLength(length) {
    this.length = length;
    this.rate = (this.n * SPEED_OF_SOUND) / length;
    this.lips.configure(this.areas[this.n - 1], this.rate, this.baffle);
    this.nostrils.configure(
      this.noseAreas[this.noseN - 1],
      this.rate,
      this.baffle
    );
    this.#configurePiriform();
    this.#configureLosses();
    this.#configureNoseLosses();
  }

  /**
   * Loss filter of each group of oral sections, and the junction and
   * wall surface of its wall branch.
   */
  #configureLosses() {
    if (!this.rate) {
      return;
    }
    const { ends } = this.stages;
    const sectionLength = this.length / this.n;
    const scale = this.lossShape * this.wallLoss;
    let start = 0;
    for (let group = 0; group < ends.length; group++) {
      let K = 0;
      let surface = 0;
      for (let index = start; index <= ends[group]; index++) {
        const area = this.areas[index];
        K += viscothermalLoss(1, area, scale) * sectionLength;
        surface += wallSurface(area, sectionLength);
      }
      this.#setFilter(this.stages, group, K);
      this.wallSurface[group] = surface;
      // The branch hangs at the junction in the middle of the group, where
      // its pressure is closest to the mean pressure on the wall of the
      // group (a two-port junction: not the velum or the piriform fossae).
      let junction = Math.max(
        1,
        Math.min(this.n - 1, Math.round((start + ends[group] + 1) / 2))
      );
      if (junction === this.velumIndex || junction === this.piriform.index) {
        junction = junction > 1 ? junction - 1 : junction + 1;
      }
      this.wallJunction[group] = junction;
      start = ends[group] + 1;
    }
  }

  /** Loss filters of the nose: the nasal walls lose nasalLoss times more. */
  #configureNoseLosses() {
    if (!this.rate) {
      return;
    }
    const { ends } = this.noseStages;
    const sectionLength = this.length / this.n;
    const scale = this.lossShape * this.wallLoss * this.nasalLoss;
    let start = 0;
    for (let group = 0; group < ends.length; group++) {
      let K = 0;
      for (let index = start; index <= ends[group]; index++) {
        K += viscothermalLoss(1, this.noseAreas[index], scale) * sectionLength;
      }
      this.#setFilter(this.noseStages, group, K);
      start = ends[group] + 1;
    }
  }

  #setFilter(stages, group, K) {
    const { b0, b1, a1 } = designLossFilter(K, this.rate);
    stages.b0[group] = b0;
    stages.b1[group] = b1;
    stages.a1[group] = a1;
  }

  /**
   * The piriform fossae (two blind tubes of half the opening each) lose
   * the constriction loss in every section and their boundary-layer loss
   * of a round trip in one loss filter on the wave reflected at their far
   * end.
   */
  #configurePiriform() {
    const { piriform } = this;
    if (!piriform.right.length || !this.rate) {
      return;
    }
    const sectionLength = this.length / this.n;
    const area = piriform.area / 2;
    piriform.damping = this.#loss(area);
    const K =
      2 *
      piriform.right.length *
      viscothermalLoss(1, area, this.lossShape * this.wallLoss) *
      sectionLength;
    Object.assign(piriform.filter, designLossFilter(K, this.rate));
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
      damping: this.#loss(branch.area / 2),
      filter: { b0: 1, b1: 0, a1: 0, input: 0, output: 0 },
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
    for (let index = 0; index < this.noseN; index++) {
      const position = (index / (this.noseN - 1)) * (areas.length - 1);
      const lower = Math.floor(position);
      const upper = Math.min(areas.length - 1, lower + 1);
      const fraction = position - lower;
      const area = areas[lower] * (1 - fraction) + areas[upper] * fraction;
      this.noseProfile[index] = Math.max(MIN_AREA, area);
    }
    for (let index = 1; index < this.noseN; index++) {
      const area = this.noseProfile[index];
      this.noseAreas[index] = area;
      this.noseDamping[index] = this.#noseLoss(area);
    }
    for (let index = 2; index < this.noseN; index++) {
      const a = this.noseAreas[index - 1];
      const b = this.noseAreas[index];
      this.noseReflection[index] = (a - b) / (a + b);
    }
    this.#applyPort();
    this.#configureNoseLosses();
    this.nostrils.configure(
      this.noseAreas[this.noseN - 1],
      this.rate,
      this.baffle
    );
  }

  /**
   * Nose section 0 is the velopharyngeal port: give it the port area, so
   * the flow that enters the nose at the velum junction is the flow that
   * travels on (a port wider than the first nose section is allowed).
   */
  #applyPort() {
    const area = Math.max(MIN_AREA, this.velumArea);
    this.noseAreas[0] = area;
    this.noseDamping[0] = this.#noseLoss(area);
    if (this.noseN > 1) {
      const next = this.noseAreas[1];
      this.noseReflection[1] = (area - next) / (area + next);
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
      this.damping[index] = this.#loss(area);
    }
    for (let index = 1; index < this.n; index++) {
      const a = this.areas[index - 1];
      const b = this.areas[index];
      this.reflection[index] = (a - b) / (a + b);
    }
    this.velumArea = Math.max(0, velumArea);
    this.velumIndex = Math.min(this.n - 2, Math.max(1, velumIndex));
    this.#applyPort();
    this.#configureLosses();
    this.#configureNoseLosses();
    this.lips.configure(this.areas[this.n - 1], this.rate, this.baffle);
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

  /** Uniform blind tube: plain delay with a rigid (+1), lossy far end. */
  #propagatePiriform() {
    const { right, left, damping, filter } = this.piriform;
    const last = right.length - 1;
    if (last < 0) {
      return;
    }
    const end =
      filter.b0 * right[last] +
      filter.b1 * filter.input -
      filter.a1 * filter.output;
    filter.input = right[last];
    filter.output = end;
    for (let index = 0; index < last; index++) {
      left[index] = left[index + 1] * damping;
    }
    left[last] = end * damping;
    for (let index = last; index > 0; index--) {
      right[index] = right[index - 1] * damping;
    }
    right[0] = this.piriform.entering * damping;
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
    const reflected = this.nostrils.process(noseRight[last]);
    this.noseJunctionLeft[this.noseN] = reflected;
    this.noseOutput = (noseRight[last] - reflected) * this.noseAreas[last];
  }

  /**
   * Yielding walls: each group's wall, a mass-damper-spring per cm² driven
   * by the pressure at its junction, takes its flow U_w out of the tract
   * (semi-implicit Euler, U_w first, then the wall volume V_w).
   */
  #yieldWalls() {
    const { junctionRight, junctionLeft, left, areas } = this;
    const step = 1 / this.rate;
    const mass = this.wallMass;
    const resistance = this.wallResistance;
    const stiffness = this.wallStiffness;
    const impedance = AIR_DENSITY * SPEED_OF_SOUND;
    for (let group = 0; group < this.wallJunction.length; group++) {
      const junction = this.wallJunction[group];
      const pressure = impedance * (junctionRight[junction] + left[junction]);
      const surface = this.wallSurface[group];
      const volume = this.wallVolume[group];
      const area = areas[junction - 1] + areas[junction];
      // The wall flow U_w lowers the junction pressure by rho c U_w / (a + b)
      // in the same step, which damps the wall like the resistance does;
      // both are integrated implicitly so the coupling cannot gain energy.
      const rate = step / mass;
      const flow =
        (this.wallFlow[group] +
          rate * (surface * pressure - stiffness * volume)) /
        (1 + rate * (resistance + (surface * impedance) / area));
      this.wallFlow[group] = flow;
      this.wallVolume[group] = volume + step * flow;
      // A flow source -U_w lowers both outgoing waves by U_w / (a + b).
      const drop = flow / area;
      junctionRight[junction] -= drop;
      junctionLeft[junction] -= drop;
    }
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
    this.#filterStages(this.stages, right, left);
    this.#filterStages(this.noseStages, noseRight, noseLeft);
  }

  /** Boundary-layer loss of each group on both waves of its last section. */
  #filterStages(stages, right, left) {
    const { ends } = stages;
    for (let group = 0; group < ends.length; group++) {
      const end = ends[group];
      right[end] = filterStage(
        stages,
        group,
        right[end],
        stages.rightInput,
        stages.rightOutput
      );
      left[end] = filterStage(
        stages,
        group,
        left[end],
        stages.leftInput,
        stages.leftOutput
      );
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
      this.left[0] * this.glottalReflection + glottalFlow / this.areas[0];
    const last = this.n - 1;
    const reflected = this.lips.process(this.right[last]);
    this.junctionLeft[this.n] = reflected;
    this.lipOutput = (this.right[last] - reflected) * this.areas[last];
    this.#scatterOral();
    this.#scatterVelum();
    this.#scatterPiriform();
    this.#scatterNose();
    if (noise !== 0) {
      const position = Math.min(this.n - 1, Math.max(1, noisePosition));
      this.junctionRight[position] += noise * 0.5;
      this.junctionLeft[position] -= noise * 0.5;
    }
    if (this.walls) {
      this.#yieldWalls();
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
      this.piriform.right,
      this.piriform.left,
      this.wallFlow,
      this.wallVolume,
    ]) {
      array.fill(0);
    }
    for (const stages of [this.stages, this.noseStages]) {
      stages.rightInput.fill(0);
      stages.rightOutput.fill(0);
      stages.leftInput.fill(0);
      stages.leftOutput.fill(0);
    }
    this.piriform.entering = 0;
    this.piriform.filter.input = 0;
    this.piriform.filter.output = 0;
    this.lips.reset();
    this.nostrils.reset();
  }
}
