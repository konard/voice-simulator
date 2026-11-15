/**
 * The subglottal tract (issue 34): the trachea and the main bronchi below
 * the glottis as a Kelly-Lochbaum line, for the source-tract interaction
 * of the vocal folds (folds.js, VoiceRenderer `interaction`).
 *
 * Going down from the glottis the line is TRACHEA_LENGTH cm of
 * TRACHEA_AREA cm², then BRONCHI_LENGTH cm whose area grows exponentially
 * to BRONCHI_AREA cm² (Ishizaka, Matsudaira and Kaneko 1976; Titze 2008).
 * Both lengths scale with the vocal tract length (relative to 16.5 cm) and
 * with the head's `subglottalLength`. The far end opens into the lungs,
 * modelled as the radiation load (radiation.js) of the end area on a free
 * pipe. Its three lowest resonances, 630, 1490 and 2310 Hz, lie near the
 * subglottal resonances measured in adults (Ishizaka et al. 1976; Lulich
 * 2010).
 *
 * The glottal end reflects fully: the folds are a flow source and the
 * flow they take from the trachea (the negative of the flow into the
 * vocal tract) enters there, as the glottal flow enters the tract. The
 * line runs SUBGLOTTAL_DECIMATION times slower than the tract solver, so
 * each section is SUBGLOTTAL_DECIMATION * c * dt long; the inputs of the
 * skipped steps are averaged and the wave arriving at the glottis is held
 * in between. Waves are pressure / (rho c), like those of the waveguide.
 *
 * The walls of the trachea are soft and its mucus is thick: the boundary
 * loss of a section is boundaryLossFactor (waveguide.js) with SUBGLOTTAL_LOSS
 * times the head's wall loss, which gives the first resonance a bandwidth
 * of about 200 Hz, within the 150-350 Hz that Ishizaka et al. (1976) and
 * Cranen and Boves (1987) measured (experiments/issue-11-interaction.mjs).
 */

import { Radiation } from './radiation.js';
import { SPEED_OF_SOUND } from './constants.js';
import { LOSS_REFERENCE_SECTIONS } from './losses.js';
import { REST_LENGTH, boundaryLossFactor } from './waveguide.js';

/** Length (cm) and area (cm²) of the trachea at a 16.5 cm vocal tract. */
export const TRACHEA_LENGTH = 10;
export const TRACHEA_AREA = 2.5;
/** Length (cm) of the bronchi, which widen to BRONCHI_AREA (cm²). */
export const BRONCHI_LENGTH = 8;
export const BRONCHI_AREA = 20;
/**
 * Boundary loss of the subglottal walls relative to the vocal tract walls
 * (1-8): soft walls and mucus. The issue proposed 3, which gives the
 * first resonance (630 Hz) a -3 dB bandwidth of 85 Hz; 5 gives 140 Hz,
 * 6 169 Hz, 7 197 Hz and 8 226 Hz (`node
 * experiments/issue-34-subglottal-probe.mjs 7`), and 7 lies in the
 * measured 150-350 Hz with room on both sides.
 */
export const SUBGLOTTAL_LOSS = 7;
/** The line runs this many times slower than the tract solver. */
export const SUBGLOTTAL_DECIMATION = 2;
/** The lungs: a free pipe end, no baffle. */
const LUNG_BAFFLE = 0;

/**
 * Lengths and areas of the subglottal tract of a head, going down from the
 * glottis.
 * @param {{vocalTractLength?: number, subglottalLength?: number}} [head]
 * @returns {{trachea: number, bronchi: number, length: number, area: (distance: number) => number}}
 *   `trachea` and `bronchi` are the lengths (cm) of the two parts,
 *   `length` their sum and `area(distance)` the area (cm²) at a distance
 *   (cm) below the glottis.
 */
export function subglottalShape(head = {}) {
  const scale =
    ((head.vocalTractLength ?? REST_LENGTH) / REST_LENGTH) *
    (head.subglottalLength ?? 1);
  const trachea = TRACHEA_LENGTH * scale;
  const bronchi = BRONCHI_LENGTH * scale;
  const growth = Math.log(BRONCHI_AREA / TRACHEA_AREA) / bronchi;
  return {
    trachea,
    bronchi,
    length: trachea + bronchi,
    area: (distance) =>
      distance <= trachea
        ? TRACHEA_AREA
        : TRACHEA_AREA *
          Math.exp(growth * Math.min(bronchi, distance - trachea)),
  };
}

export class Subglottal {
  /**
   * @param {{vocalTractLength?: number, subglottalLength?: number, wallLoss?: number}} [head]
   * @param {number} [dt] Step of the tract solver (s); the line is laid
   *   out at the first configure (or here) and keeps its sections.
   */
  constructor(head = {}, dt) {
    this.shape = subglottalShape(head);
    this.wallLoss = (head.wallLoss ?? 1) * SUBGLOTTAL_LOSS;
    this.far = new Radiation();
    this.dt = Number.NaN;
    this.n = 0;
    this.areas = new Float64Array(0);
    if (dt > 0) {
      this.configure(dt);
    }
  }

  /**
   * Set the step of the tract solver (s). The first call lays out the
   * sections (SUBGLOTTAL_DECIMATION * c * dt long); later calls keep them
   * and only retune the far end, so the resonances move with dt as the
   * tract's formants do with its length.
   * @param {number} dt
   */
  configure(dt) {
    if (dt === this.dt) {
      return;
    }
    this.dt = dt;
    if (this.n === 0) {
      this.#layout(SUBGLOTTAL_DECIMATION * SPEED_OF_SOUND * dt);
    }
    this.far.configure(
      this.areas[this.n - 1],
      1 / (SUBGLOTTAL_DECIMATION * dt),
      LUNG_BAFFLE
    );
  }

  #layout(sectionLength) {
    const { shape } = this;
    const n = Math.max(2, Math.round(shape.length / sectionLength));
    const step = shape.length / n;
    this.n = n;
    this.areas = Float64Array.from({ length: n }, (_, index) =>
      shape.area((index + 0.5) * step)
    );
    this.reflection = new Float64Array(n);
    for (let index = 1; index < n; index++) {
      const a = this.areas[index - 1];
      const b = this.areas[index];
      this.reflection[index] = (a - b) / (a + b);
    }
    // boundaryLossFactor is per reference section of the rest tract.
    const exponent = step / (REST_LENGTH / LOSS_REFERENCE_SECTIONS);
    this.damping = this.areas.map(
      (area) => boundaryLossFactor(area, this.wallLoss) ** exponent
    );
    this.down = new Float64Array(n);
    this.up = new Float64Array(n);
    this.spareDown = new Float64Array(n);
    this.spareUp = new Float64Array(n);
    this.input = 0;
    this.count = 0;
    this.arriving = 0;
  }

  /** Wave (pressure / rho c) arriving at the glottis from below. */
  get incident() {
    return this.arriving;
  }

  /** Area (cm²) of the section at the glottis. */
  get area() {
    return this.areas[0];
  }

  /**
   * Advance one step of the tract solver.
   * @param {number} flowIn Flow (derivative, as the tract's glottal
   *   source) entering the line at the glottis: the negative of the
   *   glottal flow into the vocal tract.
   */
  step(flowIn) {
    this.input += flowIn;
    if (++this.count < SUBGLOTTAL_DECIMATION) {
      return;
    }
    const flow = this.input / SUBGLOTTAL_DECIMATION;
    this.input = 0;
    this.count = 0;
    const { down, up, reflection, damping, n } = this;
    const nextDown = this.spareDown;
    const nextUp = this.spareUp;
    // Glottal end: full reflection plus the flow entering there.
    nextDown[0] = (up[0] + flow / this.areas[0]) * damping[0];
    for (let index = 1; index < n; index++) {
      const incomingDown = down[index - 1];
      const incomingUp = up[index];
      const w = reflection[index] * (incomingDown - incomingUp);
      nextDown[index] = (incomingDown + w) * damping[index];
      nextUp[index - 1] = (incomingUp + w) * damping[index - 1];
    }
    nextUp[n - 1] = this.far.process(down[n - 1]) * damping[n - 1];
    this.spareDown = down;
    this.spareUp = up;
    this.down = nextDown;
    this.up = nextUp;
    this.arriving = nextUp[0];
  }

  reset() {
    for (const array of [this.down, this.up, this.spareDown, this.spareUp]) {
      array?.fill(0);
    }
    this.input = 0;
    this.count = 0;
    this.arriving = 0;
    this.far.reset();
  }
}
