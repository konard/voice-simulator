/**
 * 2D finite-difference time-domain (FDTD) acoustic solver on the sheet of
 * sheet-model.js: the vocal tract unrolled into the plane x (glottis ->
 * lips) times y (across the tract), every cell with a depth h (issue 37).
 * It sits between the 1D waveguide, which only knows plane waves, and the
 * 3D solver on the voxel head (fdtd3d.js): the sheet carries the transverse
 * modes across a wide cavity above about 3 kHz and the air passing beside
 * the tongue in laterals, at a few per cent of the 3D cost.
 *
 * Pressure lives in the cell centres, the (normalised, u = rho c v)
 * particle velocity on the faces between cells. A face conducts with the
 * harmonic mean depth hf = 2 h1 h2 / (h1 + h2) of its cells (0 next to a
 * wall), and with lambda = c dt / dx the depth-averaged wave equation
 * becomes
 *
 *   u_f  = d_f (u_f - lambda (p_b - p_a))
 *   p_i  = keep_i p_i - gain_i sum_f(+-hf_f u_f)
 *
 * which conserves the energy of a horn of the column areas sum(h) dx for
 * Courant numbers up to 1 / sqrt(2). Boundaries are admittances Y (relative
 * to rho c) folded into keep_i = (1 - lambda Y / 2) / (1 + lambda Y / 2) and
 * gain_i = lambda / (h_i (1 + lambda Y / 2)):
 *
 * - walls: the two flat sides (2 dx / h per cell) and the faces next to a
 *   wall cell absorb with the waveguide's boundary loss converted to a
 *   wall admittance (WALL_ADMITTANCE); the faces keep the rest of the
 *   waveguide's loss model (lossFactor without its boundary term);
 * - the glottis: the first column ends in the glottis admittance of the
 *   waveguide's reflection, and the source flow enters it evenly;
 * - the lips: the last column radiates into Flanagan's piston load of the
 *   lip area (radiation.js), a resistance in parallel with an inertance
 *   that is integrated per cell; the output is the flow through that load;
 * - the nose and the pouches: 1D lines (nose-line.js) hang off the column
 *   of their opening, which drives them with its mean pressure and feels
 *   the flow they take.
 *
 * Turbulence noise is a pressure jump across the open faces of the plane
 * at `noisePosition`, as in the waveguide. The grid has the head's rest
 * tract length; a longer or shorter tract stretches the time step (see
 * stepDuration).
 */

import { glottalReflection } from './glottis.js';
import { NoseLine, lossFactor } from './nose-line.js';
import { RADIATION_RESISTANCE } from './radiation.js';
import { SPEED_OF_SOUND } from './transfer.js';
import { LOSS_REFERENCE_SECTIONS } from './waveguide.js';
import { sideBranches } from './sinuses.js';
import { buildSheet, sheetColumn, updateSheet } from './sheet-model.js';
import { noseShape } from '../articulation/tract-shape.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';

/** Courant number c dt / dx (stable below 1 / sqrt(2)). */
export const COURANT_2D = 0.68;
/** Waveguide boundary-loss coefficient (see lossFactor). */
const BOUNDARY_LOSS = 0.0004;
/** Smallest column area the losses see (cm², as in lossFactor). */
const LOSS_AREA = 0.05;
const MIN_AREA = 1e-4;

export class Fdtd2d {
  /**
   * `sheet` takes a prebuilt buildSheet(head, {dx}); `piriform: false` or
   * `vallecula: false` leave out a pouch.
   * @param {{head?: object, dx?: number, sheet?: object, piriform?: boolean, vallecula?: boolean}} [options]
   */
  constructor(options = {}) {
    const head = normalizeHeadConfig(options.head ?? {});
    this.head = head;
    this.sheet = options.sheet ?? buildSheet(head, { dx: options.dx });
    const { dx, columns, rows } = this.sheet;
    this.dx = dx;
    this.columns = columns;
    this.rows = rows;
    this.courant = COURANT_2D;
    this.dt = (COURANT_2D * dx) / SPEED_OF_SOUND;
    /** Grid tract length (cm); the dynamic length stretches the step. */
    this.restLength = this.sheet.length;
    this.length = head.vocalTractLength;
    this.wallLoss = options.head?.wallLoss ?? 1;
    this.nasalLoss = options.head?.nasalLoss ?? DEFAULT_HEAD.nasalLoss;
    const reflection = glottalReflection(options.head);
    this.glottisAdmittance = (1 - reflection) / (1 + reflection);
    // lossFactor gives the loss of a wave per section of rest / 44 cm. The
    // faces damp the velocity only, which holds half of the wave's energy,
    // so they take twice the exponent of the distance a wave travels in
    // one step.
    const exponent = (LOSS_REFERENCE_SECTIONS * COURANT_2D) / columns;
    this.faceExponent = 2 * exponent;
    /**
     * Wall admittance per unit of wall area: the waveguide's boundary loss
     * 0.0004 / sqrt(A) per section of a round tube of perimeter
     * 2 sqrt(pi A), as an absorbing wall.
     */
    this.wallAdmittance =
      (BOUNDARY_LOSS * this.wallLoss * LOSS_REFERENCE_SECTIONS) /
      (this.restLength * Math.sqrt(Math.PI));
    this.#allocate();
    this.#allocateLines(options, exponent);
    this.pending = [];
    this.noiseColumn = -1;
    this.areaCount = 44;
    this.dirty = true;
    this.setShape(new Array(44).fill(1), 0);
  }

  #allocate() {
    const { columns, rows } = this;
    const cells = columns * rows;
    this.cellCount = cells;
    this.pressure = new Float64Array(cells);
    this.divergence = new Float64Array(cells);
    this.keep = new Float64Array(cells);
    this.gain = new Float64Array(cells);
    /** Faces between columns c and c + 1: index c * rows + row. */
    this.velocityX = new Float64Array((columns - 1) * rows);
    this.depthX = new Float64Array((columns - 1) * rows);
    this.dampingX = new Float64Array((columns - 1) * rows);
    /** Faces between rows r and r + 1: index c * (rows - 1) + r. */
    this.velocityY = new Float64Array(columns * (rows - 1));
    this.depthY = new Float64Array(columns * (rows - 1));
    this.dampingY = new Float64Array(columns * (rows - 1));
    /** Inertance flow per unit area through the lip load (normalised). */
    this.lipCurrent = new Float64Array(rows);
    this.lipStep = 0;
    this.lipPressure = new Float64Array(rows);
    this.fieldPressure = new Float64Array(columns);
  }

  /** Nose and pouches, one section per step of travel (lambda dx). */
  #allocateLines(options, exponent) {
    const { head, sheet } = this;
    const scale = sheet.length / head.vocalTractLength;
    const step = COURANT_2D * this.dx;
    const nose = noseShape(head);
    this.nose = new NoseLine({
      sections: Math.max(6, Math.round((nose.length * scale) / step)),
      wallLoss: this.wallLoss * this.nasalLoss,
      lossExponent: exponent,
    });
    this.nose.setProfile(nose.areas);
    this.velumArea = 0;
    this.branches = sideBranches(head, options).map((branch) => ({
      name: branch.name,
      column: sheetColumn(sheet, branch.entry / head.vocalTractLength),
      line: new NoseLine({
        sections: Math.max(2, Math.round((branch.depth * scale) / step)),
        wallLoss: this.wallLoss,
        lossExponent: exponent,
        closed: true,
        area: branch.area,
      }),
    }));
    /** Lines coupled to the sheet: {line, column}, nose first. */
    this.ports = [
      { line: this.nose, column: sheet.velumColumn, mean: 0, left: 0 },
      ...this.branches.map((branch) => ({
        line: branch.line,
        column: branch.column,
        mean: 0,
        left: 0,
      })),
    ];
  }

  /** Physical duration (s) of a step for the current length. */
  get stepTime() {
    return (this.dt * this.length) / this.restLength;
  }

  /**
   * Time step in seconds (the solver runs at 1 / dt). The grid has the
   * rest length; a tract of another length runs slower or faster by
   * length / rest length, which scales every distance of the grid.
   * @param {{length?: number}} [shape]
   */
  stepDuration(shape) {
    const length = shape?.length;
    if (!(length > 0)) {
      return this.dt;
    }
    return (this.dt * length) / this.restLength;
  }

  /**
   * Tract length (cm): sets the physical step of the lip and nostril
   * loads.
   * @param {number} length
   */
  setLength(length) {
    if (length > 0 && length !== this.length) {
      this.length = length;
      this.dirty = true;
    }
  }

  /**
   * Nasal tract cross-sections (fixed during speech).
   * @param {ArrayLike<number>} areas
   */
  setNose(areas) {
    this.nose.setProfile(areas);
    this.dirty = true;
  }

  /**
   * Oral tract area function and velopharyngeal port.
   * @param {ArrayLike<number>} areas
   * @param {number} velumArea cm².
   * @param {number} [velumIndex] Section of the port.
   * @param {object|null} [teeth] Unused: the sheet has no incisors.
   * @param {{lateral?: number, frication?: {index?: number}}} [shape] The
   *   tract shape, for the lateral channels.
   */
  setShape(areas, velumArea, velumIndex, teeth, shape) {
    updateSheet(this.sheet, {
      areas,
      velumIndex,
      lateral: shape?.lateral ?? 0,
      frication: shape?.frication,
    });
    this.velumArea = Math.max(0, velumArea);
    this.nose.setPort(this.velumArea);
    this.ports[0].column = this.sheet.velumColumn;
    this.areaCount = areas.length;
    this.dirty = true;
  }

  /**
   * Set the cell depths directly (cm, index column * rows + row), for
   * geometries that are not a tract shape. The column areas follow.
   * @param {ArrayLike<number>} depths
   */
  setDepths(depths) {
    const { h, areas } = this.sheet;
    h.set(depths);
    for (let column = 0; column < this.columns; column++) {
      let sum = 0;
      for (let row = 0; row < this.rows; row++) {
        sum += h[column * this.rows + row];
      }
      areas[column] = sum * this.dx;
    }
    this.sheet.lipArea = areas[this.columns - 1];
    this.dirty = true;
  }

  #faceDamping(area) {
    // The boundary term of lossFactor is the wall admittance here.
    const smooth =
      lossFactor(area, this.wallLoss) +
      (BOUNDARY_LOSS * this.wallLoss) / Math.sqrt(Math.max(area, LOSS_AREA));
    return Math.max(0, smooth) ** this.faceExponent;
  }

  #updateFaces() {
    const { columns, rows } = this;
    const { h, areas } = this.sheet;
    for (let column = 0; column < columns - 1; column++) {
      const damping = this.#faceDamping(
        Math.min(areas[column], areas[column + 1])
      );
      for (let row = 0; row < rows; row++) {
        const face = column * rows + row;
        const a = h[face];
        const b = h[face + rows];
        const depth = a > 0 && b > 0 ? (2 * a * b) / (a + b) : 0;
        this.depthX[face] = depth;
        this.dampingX[face] = depth > 0 ? damping : 0;
        if (depth === 0) {
          this.velocityX[face] = 0;
        }
      }
    }
    for (let column = 0; column < columns; column++) {
      const damping = this.#faceDamping(areas[column]);
      for (let row = 0; row < rows - 1; row++) {
        const face = column * (rows - 1) + row;
        const a = h[column * rows + row];
        const b = h[column * rows + row + 1];
        const depth = a > 0 && b > 0 ? (2 * a * b) / (a + b) : 0;
        this.depthY[face] = depth;
        this.dampingY[face] = depth > 0 ? damping : 0;
        if (depth === 0) {
          this.velocityY[face] = 0;
        }
      }
    }
  }

  /** Number of the four neighbours of a cell that are walls. */
  #wallNeighbours(column, row) {
    const { h } = this.sheet;
    const { rows, columns } = this;
    const index = column * rows + row;
    let walls = 0;
    if (row === 0 || h[index - 1] <= 0) {
      walls++;
    }
    if (row === rows - 1 || h[index + 1] <= 0) {
      walls++;
    }
    // The glottis and the lips close the ends; they have their own loads.
    if (column > 0 && h[index - rows] <= 0) {
      walls++;
    }
    if (column < columns - 1 && h[index + rows] <= 0) {
      walls++;
    }
    return walls;
  }

  #updateCells() {
    const { columns, rows, dx } = this;
    const { h, areas } = this.sheet;
    const lipArea = Math.max(this.sheet.lipArea, MIN_AREA);
    const radius = Math.sqrt(lipArea / Math.PI);
    // The load acts on the pressure of the cell centres, half a cell
    // inside the lip face: that half cell of air adds its inertance.
    const halfCell = (dx / 2) * (this.length / this.restLength);
    const inertance =
      ((8 * radius) / (3 * Math.PI) + halfCell) / SPEED_OF_SOUND;
    this.lipStep = this.stepTime / inertance;
    const portAdmittance = new Float64Array(columns);
    for (const port of this.ports) {
      if (port.line.open) {
        portAdmittance[port.column] +=
          port.line.portArea / Math.max(areas[port.column], MIN_AREA);
      }
    }
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows; row++) {
        const index = column * rows + row;
        const depth = h[index];
        if (depth <= 0) {
          this.keep[index] = 0;
          this.gain[index] = 0;
          this.pressure[index] = 0;
          continue;
        }
        let admittance =
          this.wallAdmittance *
            ((2 * dx) / depth + this.#wallNeighbours(column, row)) +
          portAdmittance[column];
        let extra = 0;
        if (column === 0) {
          admittance += this.glottisAdmittance;
        }
        if (column === columns - 1) {
          admittance += 1 / RADIATION_RESISTANCE;
          extra = COURANT_2D * this.lipStep;
        }
        const half = (COURANT_2D * admittance) / 2;
        this.keep[index] = (1 - half) / (1 + half + extra);
        this.gain[index] = COURANT_2D / (depth * (1 + half + extra));
      }
    }
    for (let row = 0; row < rows; row++) {
      if (h[(columns - 1) * rows + row] <= 0) {
        this.lipCurrent[row] = 0;
      }
    }
  }

  #update() {
    this.dirty = false;
    this.#updateFaces();
    this.#updateCells();
    this.nose.configure(1 / this.stepTime);
  }

  /** Column of the plane the noise crosses (faces column - 1 -> column). */
  #noiseFaces(noisePosition) {
    const share = noisePosition / this.areaCount;
    return Math.min(
      this.columns - 1,
      Math.max(1, Math.round(share * this.columns))
    );
  }

  /** h-weighted mean pressure of a column. */
  #columnMean(column) {
    const { rows } = this;
    const { h } = this.sheet;
    let sum = 0;
    let weight = 0;
    for (let index = column * rows; index < (column + 1) * rows; index++) {
      sum += h[index] * this.pressure[index];
      weight += h[index];
    }
    return weight > 0 ? sum / weight : 0;
  }

  /** Add `amount` (times each cell's depth) to a column's divergence. */
  #driveColumn(column, amount) {
    const { rows } = this;
    const { h } = this.sheet;
    for (let index = column * rows; index < (column + 1) * rows; index++) {
      this.divergence[index] += h[index] * amount;
    }
  }

  #stepFaces() {
    const { columns, rows, pressure, divergence } = this;
    const { velocityX, depthX, dampingX, velocityY, depthY, dampingY } = this;
    const lambda = COURANT_2D;
    const facesX = (columns - 1) * rows;
    for (let face = 0; face < facesX; face++) {
      const depth = depthX[face];
      if (depth === 0) {
        continue;
      }
      const b = face + rows;
      const u =
        dampingX[face] *
        (velocityX[face] - lambda * (pressure[b] - pressure[face]));
      velocityX[face] = u;
      divergence[face] += depth * u;
      divergence[b] -= depth * u;
    }
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows - 1; row++) {
        const face = column * (rows - 1) + row;
        const depth = depthY[face];
        if (depth === 0) {
          continue;
        }
        const a = column * rows + row;
        const u =
          dampingY[face] *
          (velocityY[face] - lambda * (pressure[a + 1] - pressure[a]));
        velocityY[face] = u;
        divergence[a] += depth * u;
        divergence[a + 1] -= depth * u;
      }
    }
  }

  /**
   * Advance one time step.
   * @param {number} glottalFlow Source volume velocity (derivative).
   * @param {number} noisePosition Section boundary of the turbulence source.
   * @param {number} noise Turbulence pressure.
   * @returns {number} Radiated output (lips + nostrils).
   */
  step(glottalFlow, noisePosition, noise) {
    if (this.dirty) {
      this.#update();
    }
    const { columns, rows, pressure, divergence, keep, gain } = this;
    const { h, areas } = this.sheet;
    if (noise !== 0) {
      // A pressure jump across the plane enters the momentum equation.
      const column = this.#noiseFaces(noisePosition) - 1;
      const force = COURANT_2D * noise;
      for (let face = column * rows; face < (column + 1) * rows; face++) {
        if (this.depthX[face] > 0) {
          this.velocityX[face] += force;
        }
      }
    }
    this.#stepFaces();
    // The glottal flow enters the first column evenly.
    this.#driveColumn(0, -glottalFlow / Math.max(areas[0], MIN_AREA));
    // Lines: the column feels the flow (P - 2 left) * portArea they take.
    for (const port of this.ports) {
      const { line } = port;
      port.left = line.left[0];
      if (line.open) {
        port.mean = this.#columnMean(port.column);
        const share = line.portArea / Math.max(areas[port.column], MIN_AREA);
        this.#driveColumn(port.column, -2 * share * port.left);
      }
    }
    // Lips: the inertance flow of the load leaves the last column.
    const last = (columns - 1) * rows;
    for (let row = 0; row < rows; row++) {
      divergence[last + row] += h[last + row] * this.lipCurrent[row];
      this.lipPressure[row] = pressure[last + row];
    }
    for (let index = 0; index < this.cellCount; index++) {
      pressure[index] =
        keep[index] * pressure[index] - gain[index] * divergence[index];
      divergence[index] = 0;
    }
    let output = 0;
    for (let row = 0; row < rows; row++) {
      const depth = h[last + row];
      if (depth <= 0) {
        continue;
      }
      const now = pressure[last + row];
      this.lipCurrent[row] += this.lipStep * now;
      const mean = (now + this.lipPressure[row]) / 2;
      output += depth * (mean / RADIATION_RESISTANCE + this.lipCurrent[row]);
    }
    output *= this.dx;
    for (const port of this.ports) {
      const { line } = port;
      line.junctionRight[0] = line.open
        ? (port.mean + this.#columnMean(port.column)) / 2 - port.left
        : port.left;
      line.scatter();
      line.propagate();
    }
    return output + this.nose.output;
  }

  /**
   * Queue a step (arguments as for step); flushSteps returns the outputs.
   * The step runs right away.
   */
  queueStep(glottalFlow, noisePosition, noise) {
    this.pending.push(this.step(glottalFlow, noisePosition, noise));
  }

  /**
   * Outputs of the steps queued since the last flush.
   * @returns {Promise<Float64Array>}
   */
  flushSteps() {
    const outputs = Float64Array.from(this.pending);
    this.pending = [];
    return Promise.resolve(outputs);
  }

  /**
   * Mean pressure per column and per nose section, for visualisation.
   * Arrays are reused between calls.
   * @returns {{pressure: Float64Array, nose: Float64Array, cells: Float64Array}}
   */
  field() {
    for (let column = 0; column < this.columns; column++) {
      this.fieldPressure[column] = this.#columnMean(column);
    }
    this.nosePressure ??= new Float64Array(this.nose.n);
    this.nose.pressure(this.nosePressure);
    return {
      pressure: this.fieldPressure,
      nose: this.nosePressure,
      cells: this.pressure,
    };
  }

  reset() {
    for (const array of [
      this.pressure,
      this.divergence,
      this.velocityX,
      this.velocityY,
      this.lipCurrent,
      this.lipPressure,
    ]) {
      array.fill(0);
    }
    for (const port of this.ports) {
      port.line.reset();
      port.mean = 0;
      port.left = 0;
    }
    this.pending = [];
  }
}
