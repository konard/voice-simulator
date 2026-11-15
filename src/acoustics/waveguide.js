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
  designLossFilter,
  viscothermalLoss,
  wallSurface,
} from './losses.js';
import { DEFAULT_HEAD } from '../head-config.js';

const MIN_AREA = 1e-4;

/**
 * Waves in a closed nose below this (about 200 dB under the waves of
 * speech) are silence, checked every NOSE_CHECK_STEPS steps.
 */
const NOSE_SILENCE = 1e-12;
const NOSE_CHECK_STEPS = 64;
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
 * losses.js), exp(-constrictionLoss(area)) without its log and exp. The
 * wall losses are frequency dependent (losses.js).
 * @param {number} area
 */
export function lossFactor(area) {
  return 1 - Math.min(0.3, 0.0001 / Math.max(area, 1e-3) ** 2);
}

/**
 * Attenuation of a reference section with the constriction loss and a
 * boundary loss that does not depend on frequency, scaled by `wall`: the
 * waveguide loss before issue 36, which the 2D and 3D solvers and their
 * nose lines (nose-line.js) keep.
 * @param {number} area
 * @param {number} [wall]
 */
export function boundaryLossFactor(area, wall = 1) {
  const boundary = 0.0004 / Math.sqrt(Math.max(area, 0.05));
  const constriction = Math.min(0.3, 0.0001 / Math.max(area, 1e-3) ** 2);
  return 1 - 0.0007 * wall - boundary * wall - constriction;
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
    /** K and rate each filter was designed for (see #setFilter). */
    designK: filter().fill(NaN),
    designRate: filter(),
  };
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
    /** Coefficients of the implicit wall update (see #yieldWalls). */
    this.wallDrive = new Float64Array(groups);
    this.wallGain = new Float64Array(groups);
    this.wallDrop = new Float64Array(groups);
    this.wallFlow = new Float64Array(groups);
    this.wallVolume = new Float64Array(groups);
    this.wallStep = 0;
    this.wallSpring = 0;
    /** The loss filters follow setShape and setLength at the next step. */
    this.lossesStale = true;
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
    /** The waves of the next step are built here, then swapped in. */
    this.spareRight = new Float64Array(n);
    this.spareLeft = new Float64Array(n);
    /** Three-port junctions (velum, piriform fossae) in order. */
    this.specials = new Int32Array(0);
    this.areas = new Float64Array(n).fill(1);
    this.reflection = new Float64Array(n + 1);
    this.damping = new Float64Array(n).fill(this.#loss(1));
    this.noseRight = new Float64Array(nose);
    this.noseLeft = new Float64Array(nose);
    this.spareNoseRight = new Float64Array(nose);
    this.spareNoseLeft = new Float64Array(nose);
    /** Wave entering the nose at the port, from the velum junction. */
    this.noseEntering = 0;
    /** A closed, silent nose is skipped (see #silenceNose). */
    this.noseSilent = false;
    this.noseCheck = 0;
    this.noseAreas = new Float64Array(nose).fill(1);
    /** Nose profile from setNose; section 0 is replaced by the port. */
    this.noseProfile = new Float64Array(nose).fill(1);
    this.noseReflection = new Float64Array(nose + 1);
    this.noseDamping = new Float64Array(nose).fill(this.#noseLoss(1));
    this.velumArea = 0;
    this.velumIndex = Math.round(n * 0.45);
    /** Velum index the junction flags were set for (#markJunctions). */
    this.markedVelum = NaN;
    /** Outgoing waves of the velum junction when the port is open. */
    this.velumOpen = false;
    this.velumRight = 0;
    this.velumLeft = 0;
    this.#applyPort();
    this.lipOutput = 0;
    this.noseOutput = 0;
    this.#allocatePiriform(options);
    this.setLength(options.head?.vocalTractLength ?? REST_LENGTH);
  }

  #loss(area) {
    const factor = lossFactor(area);
    return this.lossExponent === 1 ? factor : factor ** this.lossExponent;
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
    this.lossesStale = true;
  }

  /** Redesign the loss filters and walls once after shape or length changes. */
  #refreshLosses() {
    this.lossesStale = false;
    this.#configurePiriform();
    this.#configureLosses();
    this.#configureNoseLosses();
    // The three-port junctions move only with the velum.
    if (this.markedVelum !== this.velumIndex) {
      this.markedVelum = this.velumIndex;
      this.#markJunctions();
    }
  }

  /** Flag the junctions that #scatterOral cannot treat as two-ports. */
  #markJunctions() {
    const { piriform } = this;
    this.piriformOpen =
      piriform.right.length > 0 && piriform.index !== this.velumIndex;
    const flagged = [this.velumIndex];
    if (this.piriformOpen) {
      flagged.push(piriform.index);
    }
    this.specials = Int32Array.from(flagged).sort();
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
    const { areas } = this;
    const sectionLength = this.length / this.n;
    // viscothermalLoss(1, area) and wallSurface(area) are both set by the
    // radius r of a section (areas are at least MIN_AREA, as in
    // viscothermalLoss): k / r and 2 pi r per cm.
    const perRadius =
      viscothermalLoss(1, Math.PI, this.lossShape * this.wallLoss) *
      sectionLength;
    const perimeter = wallSurface(Math.PI, sectionLength);
    const step = 1 / this.rate;
    const rate = step / this.wallMass;
    const impedance = AIR_DENSITY * SPEED_OF_SOUND;
    this.wallStep = step;
    this.wallSpring = rate * this.wallStiffness;
    let start = 0;
    for (let group = 0; group < ends.length; group++) {
      let inverse = 0;
      let radii = 0;
      for (let index = start; index <= ends[group]; index++) {
        const radius = Math.sqrt(areas[index] / Math.PI);
        inverse += 1 / radius;
        radii += radius;
      }
      this.#setFilter(this.stages, group, perRadius * inverse);
      const surface = perimeter * radii;
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
      const area = areas[junction - 1] + areas[junction];
      this.wallDrive[group] = rate * surface * impedance;
      this.wallGain[group] =
        1 / (1 + rate * (this.wallResistance + (surface * impedance) / area));
      this.wallDrop[group] = 1 / area;
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
    // Most groups keep their K from one shape update to the next.
    if (K === stages.designK[group] && this.rate === stages.designRate[group]) {
      return;
    }
    stages.designK[group] = K;
    stages.designRate[group] = this.rate;
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
    const { filter } = piriform;
    if (K !== filter.K || this.rate !== filter.rate) {
      Object.assign(filter, designLossFilter(K, this.rate), {
        K,
        rate: this.rate,
      });
    }
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
      filter: { b0: 1, b1: 0, a1: 0, input: 0, output: 0, K: NaN, rate: 0 },
      entering: 0,
      /** Outgoing waves of the oral tract at the branch junction. */
      toRight: 0,
      toLeft: 0,
    };
    this.piriformOpen = false;
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
    this.lossesStale = true;
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
    this.lossesStale = true;
    this.lips.configure(this.areas[this.n - 1], this.rate, this.baffle);
  }

  /**
   * Scatter the oral waves at every junction and move them one section on
   * with the constriction loss of each section, from the waves of the last
   * step (`right`, `left`) into the spare buffers, which then become the
   * waves. Junction 0 (glottis) and n (lips) are given; the three-port
   * junctions of the velum and the piriform fossae and the noise and flow
   * sources take the slower path of flagged junctions, and the yielding
   * walls then draw their flow from the new waves (#yieldWalls).
   * @param {number} glottis Wave leaving the glottis (junction 0).
   * @param {number} lips Wave reflected at the lips (junction n).
   * @param {number} position Junction of the noise source, or -1.
   * @param {number} addRight Source added to the right-going wave there:
   *   half the flow source plus half the noise pressure.
   * @param {number} addLeft Source added to the left-going wave there:
   *   half the flow source minus half the noise pressure.
   */
  #scatterOral(glottis, lips, position, addRight, addLeft) {
    const { right, left, reflection, damping, specials } = this;
    const nextRight = this.spareRight;
    const nextLeft = this.spareLeft;
    const n = this.n;
    nextRight[0] = glottis * damping[0];
    let index = 1;
    let special = 0;
    for (;;) {
      // Plain two-ports up to the next flagged junction or the noise.
      let stop = special < specials.length ? specials[special] : n;
      if (position >= index && position < stop) {
        stop = position;
      }
      for (; index < stop; index++) {
        const incomingRight = right[index - 1];
        const incomingLeft = left[index];
        const w = reflection[index] * (incomingRight - incomingLeft);
        nextRight[index] = (incomingRight + w) * damping[index];
        nextLeft[index - 1] = (incomingLeft + w) * damping[index - 1];
      }
      if (index >= n) {
        break;
      }
      this.#scatterSpecial(index, position, addRight, addLeft);
      if (index === specials[special]) {
        special++;
      }
      index++;
    }
    nextLeft[n - 1] = lips * damping[n - 1];
    if (this.walls) {
      this.#yieldWalls(position, addRight);
    }
    this.spareRight = right;
    this.spareLeft = left;
    this.right = nextRight;
    this.left = nextLeft;
  }

  /**
   * A flagged junction of #scatterOral: the three-port junctions of the
   * velum and the piriform fossae, and the noise source.
   */
  #scatterSpecial(index, position, addRight, addLeft) {
    const incomingRight = this.right[index - 1];
    const incomingLeft = this.left[index];
    let outRight;
    let outLeft;
    if (index === this.velumIndex && this.velumOpen) {
      outRight = this.velumRight;
      outLeft = this.velumLeft;
    } else if (index === this.piriform.index && this.piriformOpen) {
      outRight = this.piriform.toRight;
      outLeft = this.piriform.toLeft;
    } else {
      const w = this.reflection[index] * (incomingRight - incomingLeft);
      outRight = incomingRight + w;
      outLeft = incomingLeft + w;
    }
    if (index === position) {
      outRight += addRight;
      outLeft += addLeft;
    }
    this.spareRight[index] = outRight * this.damping[index];
    this.spareLeft[index - 1] = outLeft * this.damping[index - 1];
  }

  /** Three-port junction between pharynx, oral cavity and nose. */
  #scatterVelum() {
    const index = this.velumIndex;
    const a = this.areas[index - 1];
    const b = this.areas[index];
    const c = this.velumArea;
    this.velumOpen = c > MIN_AREA;
    if (!this.velumOpen) {
      this.noseEntering = this.noseLeft[0];
      return;
    }
    const fromLeft = this.right[index - 1];
    const fromRight = this.left[index];
    const fromNose = this.noseLeft[0];
    const pressure =
      (2 * (a * fromLeft + b * fromRight + c * fromNose)) / (a + b + c);
    this.velumRight = pressure - fromRight;
    this.velumLeft = pressure - fromLeft;
    this.noseEntering = pressure - fromNose;
  }

  /** Three-port junction into the closed piriform branch. */
  #scatterPiriform() {
    const { piriform } = this;
    const { index, area, left } = piriform;
    if (!this.piriformOpen) {
      return;
    }
    const a = this.areas[index - 1];
    const b = this.areas[index];
    const fromLeft = this.right[index - 1];
    const fromRight = this.left[index];
    const fromSide = left[0];
    const pressure =
      (2 * (a * fromLeft + b * fromRight + area * fromSide)) / (a + b + area);
    piriform.toRight = pressure - fromRight;
    piriform.toLeft = pressure - fromLeft;
    piriform.entering = pressure - fromSide;
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

  /**
   * A closed nose whose waves have died away (below NOSE_SILENCE) falls
   * silent: its state is cleared and it is skipped (it would stay
   * silent) until the velum opens again.
   */
  #silenceNose() {
    const { noseStages, nostrils } = this;
    const states = [
      this.noseRight,
      this.noseLeft,
      noseStages.rightInput,
      noseStages.rightOutput,
      noseStages.leftInput,
      noseStages.leftOutput,
    ];
    for (const array of states) {
      for (let index = 0; index < array.length; index++) {
        if (Math.abs(array[index]) > NOSE_SILENCE) {
          return;
        }
      }
    }
    if (
      Math.abs(nostrils.input) > NOSE_SILENCE ||
      Math.abs(nostrils.output) > NOSE_SILENCE
    ) {
      return;
    }
    for (const array of states) {
      array.fill(0);
    }
    nostrils.reset();
    this.noseOutput = 0;
    this.noseSilent = true;
  }

  /** The nasal counterpart of #scatterOral (port at 0, nostrils at the end). */
  #scatterNose() {
    const { noseRight, noseLeft, noseReflection, noseDamping } = this;
    const nextRight = this.spareNoseRight;
    const nextLeft = this.spareNoseLeft;
    const n = this.noseN;
    nextRight[0] = this.noseEntering * noseDamping[0];
    for (let index = 1; index < n; index++) {
      const incomingRight = noseRight[index - 1];
      const incomingLeft = noseLeft[index];
      const w = noseReflection[index] * (incomingRight - incomingLeft);
      nextRight[index] = (incomingRight + w) * noseDamping[index];
      nextLeft[index - 1] = (incomingLeft + w) * noseDamping[index - 1];
    }
    const last = n - 1;
    const reflected = this.nostrils.process(noseRight[last]);
    nextLeft[last] = reflected * noseDamping[last];
    this.noseOutput = (noseRight[last] - reflected) * this.noseAreas[last];
    this.spareNoseRight = noseRight;
    this.spareNoseLeft = noseLeft;
    this.noseRight = nextRight;
    this.noseLeft = nextLeft;
  }

  /**
   * Yielding wall of each group, a mass-damper-spring per cm² driven by
   * the pressure of its two-port junction, whose flow U_w leaves the tract
   * there (semi-implicit Euler, U_w first, then the wall volume V_w). Runs
   * after #scatterOral has built the new waves (`spareRight`,
   * `spareLeft`) and lowers both outgoing waves of the junction. Walls at
   * one junction are neighbours in group order (the junctions do not
   * decrease with the group), and each sees the pressure the walls before
   * it left.
   * @param {number} position Junction of the noise source, or -1.
   * @param {number} addRight Source added to the right-going wave there
   *   (see #scatterOral).
   */
  #yieldWalls(position, addRight) {
    const { right, left, reflection, damping, wallJunction } = this;
    const { wallFlow, wallVolume, wallDrive, wallGain, wallDrop } = this;
    const nextRight = this.spareRight;
    const nextLeft = this.spareLeft;
    const spring = this.wallSpring;
    const step = this.wallStep;
    let junction = -1;
    let pressure = 0;
    for (let group = 0; group < wallJunction.length; group++) {
      const index = wallJunction[group];
      if (index !== junction) {
        junction = index;
        // Pressure of the scattered waves, outRight + incomingLeft.
        const incomingRight = right[index - 1];
        const incomingLeft = left[index];
        pressure =
          incomingRight +
          incomingLeft +
          reflection[index] * (incomingRight - incomingLeft) +
          (index === position ? addRight : 0);
      }
      // The wall flow U_w lowers the junction pressure by rho c U_w /
      // (a + b) in the same step, which damps the wall like the
      // resistance does; both are integrated implicitly so the coupling
      // cannot gain energy: U_w = (U_w + dt / m (S p - k V_w)) / (1 + dt /
      // m (b + S rho c / (a + b))), with the factors of #configureLosses.
      const flow =
        (wallFlow[group] +
          wallDrive[group] * pressure -
          spring * wallVolume[group]) *
        wallGain[group];
      wallFlow[group] = flow;
      wallVolume[group] += step * flow;
      // A flow source -U_w lowers both outgoing waves by U_w / (a + b).
      const drop = flow * wallDrop[group];
      pressure -= drop;
      nextRight[index] -= drop * damping[index];
      nextLeft[index - 1] -= drop * damping[index - 1];
    }
  }

  /** Boundary-layer loss of each group on both waves of its last section. */
  #filterStages(stages, right, left) {
    const { ends, b0, b1, a1, rightInput, rightOutput, leftInput, leftOutput } =
      stages;
    for (let group = 0; group < ends.length; group++) {
      const end = ends[group];
      const gain = b0[group];
      const zero = b1[group];
      const pole = a1[group];
      const toRight = right[end];
      const toLeft = left[end];
      const outRight =
        gain * toRight + zero * rightInput[group] - pole * rightOutput[group];
      const outLeft =
        gain * toLeft + zero * leftInput[group] - pole * leftOutput[group];
      rightInput[group] = toRight;
      rightOutput[group] = outRight;
      leftInput[group] = toLeft;
      leftOutput[group] = outLeft;
      right[end] = outRight;
      left[end] = outLeft;
    }
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
    if (this.lossesStale) {
      this.#refreshLosses();
    }
    const last = this.n - 1;
    const lipWave = this.right[last];
    const reflected = this.lips.process(lipWave);
    this.lipOutput = (lipWave - reflected) * this.areas[last];
    this.#scatterVelum();
    this.#scatterPiriform();
    const source = noise !== 0 || flow !== 0;
    this.#scatterOral(
      this.left[0] * this.glottalReflection + glottalFlow / this.areas[0],
      reflected,
      source ? Math.min(last, Math.max(1, noisePosition)) : -1,
      (flow + noise) * 0.5,
      (flow - noise) * 0.5
    );
    this.#propagatePiriform();
    this.#filterStages(this.stages, this.right, this.left);
    if (this.velumOpen || !this.noseSilent) {
      this.noseSilent = false;
      this.#scatterNose();
      this.#filterStages(this.noseStages, this.noseRight, this.noseLeft);
      if (!this.velumOpen && ++this.noseCheck >= NOSE_CHECK_STEPS) {
        this.noseCheck = 0;
        this.#silenceNose();
      }
    }
    return this.lipOutput + this.noseOutput;
  }

  /**
   * The vocal tract as the folds see it (issue 34): the wave arriving at
   * the glottis (pressure / rho c, a derivative as the source) and the
   * area there. The object is reused.
   * @returns {{incident: number, area: number}}
   */
  glottalLoad() {
    this.load ??= { incident: 0, area: 0 };
    this.load.incident = this.left[0];
    this.load.area = this.areas[0];
    return this.load;
  }

  /**
   * Reflection of the waves arriving at the glottis (glottalReflection of
   * the head by default). The interactive fold source sets 1: the folds
   * then take the tract's load themselves (glottalLoad).
   * @param {number} reflection
   */
  setGlottalReflection(reflection) {
    this.glottalReflection = reflection;
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
      this.spareRight,
      this.spareLeft,
      this.noseRight,
      this.noseLeft,
      this.spareNoseRight,
      this.spareNoseLeft,
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
    this.noseSilent = false;
    this.noseCheck = 0;
  }
}
