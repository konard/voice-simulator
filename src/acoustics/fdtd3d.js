/**
 * 3D finite-difference time-domain (FDTD) acoustic solver on the sparse
 * voxel model of the head (see voxel-model.js).
 *
 * Pressure lives in cells, particle velocity on the links between them
 * (a staggered Yee-style grid). The articulators do not move voxels: every
 * tube cell has a fill fraction phi = A(s) / A_envelope(s), the share of the
 * cube that is air for the current area function, and every link conducts
 * min(phi_a, phi_b). With the energy-conserving update
 *
 *   u_l  -= lambda * (p_b - p_a)
 *   phi_i * p_i -= lambda * sum_l(g_l * u_l)
 *
 * a tube region behaves like a Webster horn of area phi * A_envelope, while
 * the wave still propagates through the real 3D shape: the pharynx bend,
 * the palate, the lip opening and the air around the face. The Courant
 * number lambda = c dt / dx stays below 1/sqrt(3), which keeps the scheme
 * stable for any fill fractions. Quantities are normalised (u = rho c v).
 *
 * The incisors are solid voxels in the slices just behind the lips: tract
 * cells outside the slot between the incisal edges are walls (no links),
 * and the slot cells carry the whole teeth cross-section, so the slot
 * width follows the jaw. In the slices around the incisors the air of a
 * section gathers in line with the slot (see openingTable in
 * voxel-model.js); elsewhere every cube of a section has the same fill.
 * The piriform fossae and the vallecula are blind pouches with a fixed
 * fill (see sinuses.js).
 *
 * The voxel tract goes on below the glottis (see LARYNX_TRAVEL in
 * voxel-model.js), and the source plane moves along it in whole cells
 * with the tract length: a lower larynx or a shorter tract moves the
 * glottis end, while the lips stay where the face has them (see
 * setShape). The cells below the source plane are closed, and the area
 * function maps onto the active part between the source plane and the
 * lips. The rest of the length, less than a cell, stretches the time
 * step (see stepDuration). Simplifications: that stretch scales the nose
 * and the air around the head with the tract (by at most half a cell,
 * 3 % at dx 1 cm), and wall losses use the same empirical loss model as
 * the 1D waveguide, converted to a loss per unit of time.
 *
 * A `microphone` option ({distance, azimuth, elevation} relative to the
 * lips) moves the receiver cell; the free-air shell grows to reach it (up
 * to MAX_RADIATION_RADIUS, the listener extrapolates beyond). An
 * `enclosure` option surrounds the head with a box of air whose walls
 * reflect according to their absorption.
 *
 * With a WebGPU `device` the step loop runs on the GPU (see fdtd-gpu.js):
 * steps are then queued with queueStep and their outputs collected with
 * flushSteps. Without one, queueStep runs the step right away, so the same
 * calls work on any solver.
 */

import { DEFAULT_HEAD } from '../head-config.js';
import { LOSS_REFERENCE_SECTIONS, boundaryLossFactor } from './waveguide.js';
import { SPEED_OF_SOUND } from './transfer.js';
import { glottalReflection } from './glottis.js';
import {
  CELL_AIR,
  CELL_NOSE,
  CELL_SINUS,
  CELL_TRACT,
  LINK_INNER,
  LINK_LIPS,
  LINK_NOSTRILS,
  LINK_SINUS,
  LINK_VELUM,
  OPEN_FACE_NORMALS,
  buildVoxelModel,
  voxelModelOptions,
} from './voxel-model.js';
import { microphonePosition, resolveMicrophone } from './microphone.js';
import { createKernel } from './fdtd-kernel.js';
import { FdtdGpu } from './fdtd-gpu.js';

const COURANT = 0.5;
const MIN_FILL = 1e-4;
/**
 * Microphone level per cm of cell size: matches the waveguide output level
 * for the same source (the radiated pressure is sampled at one point).
 */
const MICROPHONE_GAIN = 3.9;
/** Time constant of the leaky source integrator in microphone mode (s). */
const MICROPHONE_LEAK_TIME = 0.008;
const NOISE_GAIN = 1.5;
/**
 * The source plane moves to another cell when the tract length is this
 * many cells past the middle between two places (issue 40).
 */
export const GLOTTIS_HYSTERESIS = 0.15;
/**
 * Extra microphone level with the spherical boundary: the plane-wave shell
 * that MICROPHONE_GAIN was calibrated with reflects the low frequencies
 * and raises the pressure near the lips about this much
 * (experiments/issue-5-mic-calibration.mjs).
 */
const SPHERICAL_MICROPHONE_GAIN = 4.2;
/** Kind of the links that carry the spherical-wave boundary flow. */
const LINK_RADIATION = 4;

function resample(values, position) {
  const source = Math.max(
    0,
    Math.min(values.length - 1, position * values.length - 0.5)
  );
  const lower = Math.floor(source);
  const upper = Math.min(values.length - 1, lower + 1);
  return values[lower] + (values[upper] - values[lower]) * (source - lower);
}

/** Cell indices of every tube (tract, nose, pouches) sorted by arc. */
function tubeMembers(cells) {
  const tubes = [];
  cells.forEach((cell, index) => {
    if (cell.kind !== CELL_AIR) {
      const tube = cell.tube ?? cell.kind;
      (tubes[tube] ??= []).push(index);
    }
  });
  return tubes
    .filter(Boolean)
    .map((members) => members.sort((a, b) => cells[a].arc - cells[b].arc));
}

/**
 * Calls visit(index, other, weight) for every pair of cells of a tube
 * within 2 dx of arc, weighted by a triangular kernel of half-width 2 dx.
 */
function forNeighbours(cells, sorted, dx, visit) {
  const reach = 2 * dx;
  let low = 0;
  for (const index of sorted) {
    const arc = cells[index].arc;
    while (cells[sorted[low]].arc < arc - reach) {
      low++;
    }
    for (let position = low; position < sorted.length; position++) {
      const other = sorted[position];
      if (cells[other].arc > arc + reach) {
        break;
      }
      visit(index, other, 1 - Math.abs(cells[other].arc - arc) / reach);
    }
  }
}

/**
 * Cross-section of the envelope at each tube cell. Cells of a tube form
 * slices about `dx` apart in arc length; a triangular kernel of half-width
 * 2 dx sums to exactly one slice per dx, so the weighted count times dx²
 * is the voxelised cross-section.
 */
function envelopeAreas(model) {
  const { cells, dx } = model;
  const areas = new Float64Array(cells.length).fill(dx * dx);
  for (const sorted of tubeMembers(cells)) {
    for (const index of sorted) {
      areas[index] = 0;
    }
    forNeighbours(cells, sorted, dx, (index, other, weight) => {
      areas[index] += (weight * dx * dx) / 2;
    });
  }
  return areas;
}

/**
 * Open faces of the free-air shell absorb a plane wave (admittance 1). A
 * spherical wave leaving a small shell also carries the reactive flow
 * (c / r) * integral(p dt) (first-order Bayliss-Turkel condition); without
 * it the shell reflects the low frequencies and the pressure falls off
 * slower than 1/r. Each boundary cell gets a link to a ghost cell held at
 * zero pressure: the link velocity integrates the cell pressure, so with
 * conductance faces * dx / r it carries that flow.
 */
function withSphericalBoundary(model) {
  const { cells, links, openFaces, dx } = model;
  const { lips, nostrils } = model.landmarks;
  const boundary = [];
  const conductance = [];
  const admittance = Float64Array.from(openFaces);
  cells.forEach((cell, index) => {
    if (cell.kind !== CELL_AIR || openFaces[index] === 0) {
      return;
    }
    const offsets = [lips, nostrils].map((centre) =>
      cell.point.map((value, axis) => value - centre[axis])
    );
    const distances = offsets.map((offset) => Math.hypot(...offset));
    const nearest = distances[0] <= distances[1] ? 0 : 1;
    const radius = Math.max(dx, distances[nearest]);
    // A face passes the share of an outgoing wave that crosses it.
    let weight = 0;
    OPEN_FACE_NORMALS.forEach((normal, bit) => {
      if (model.openMasks[index] & (1 << bit)) {
        const cosine =
          (normal[0] * offsets[nearest][0] +
            normal[1] * offsets[nearest][1] +
            normal[2] * offsets[nearest][2]) /
          radius;
        weight += Math.max(0, cosine);
      }
    });
    admittance[index] = weight;
    boundary.push(index);
    conductance.push((weight * dx) / (radius + dx / 2));
  });
  const first = links.a.length;
  const ghost = cells.length;
  const count = first + boundary.length;
  const a = new Int32Array(count);
  a.set(links.a);
  a.set(boundary, first);
  const b = new Int32Array(count).fill(ghost);
  b.set(links.b);
  const kind = new Uint8Array(count).fill(LINK_RADIATION);
  kind.set(links.kind);
  return {
    model: {
      ...model,
      cells: [...cells, { kind: CELL_AIR, arc: 0, point: [0, 0, 0] }],
      links: { ...links, a, b, kind },
      openFaces: [...admittance, 0],
    },
    first,
    ghost,
    conductance,
  };
}

/** Index of the free-air cell closest to a point. */
function nearestAirCell(cells, point) {
  let best = -1;
  let bestDistance = Infinity;
  cells.forEach((cell, index) => {
    if (cell.kind !== CELL_AIR) {
      return;
    }
    const distance = Math.hypot(
      ...cell.point.map((value, axis) => value - point[axis])
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

export class Fdtd3d {
  /**
   * `kernel` selects the step loop: 'wasm' (default when WebAssembly is
   * available) or 'js'; both produce bit-identical output. A `device`
   * (GPUDevice, see requestGpuDevice) runs it on the GPU instead.
   * A `microphone` or `enclosure` switches the default output to
   * 'microphone'; a prebuilt `model` must then come from
   * buildVoxelModel(head, voxelModelOptions(options)).
   * @param {{head?: object, dx?: number, model?: object, output?: 'flow'|'microphone', kernel?: 'wasm'|'js', device?: object, microphone?: object, enclosure?: object}} [options]
   */
  constructor(options = {}) {
    const model =
      options.model ??
      buildVoxelModel(options.head, {
        ...options,
        ...voxelModelOptions(options),
      });
    this.model = model;
    this.dx = model.dx;
    this.dt = (COURANT * model.dx) / SPEED_OF_SOUND;
    this.courant = COURANT;
    /** Bumped whenever the link or cell coefficients change. */
    this.version = 0;
    this.noiseVersion = 0;
    const listening = Boolean(options.microphone || model.enclosure);
    this.output = options.output ?? (listening ? 'microphone' : 'flow');
    this.wallLoss = options.head?.wallLoss ?? 1;
    this.lengthScale = options.lengthScale ?? 1;
    // The nasal walls are folded: more wall per area than a round tube.
    this.nasalLoss = options.head?.nasalLoss ?? DEFAULT_HEAD.nasalLoss;
    /** Glottis termination admittance (the waveguide's reflection). */
    const reflection = glottalReflection(options.head);
    this.glottisAdmittance = (1 - reflection) / (1 + reflection);
    this.#prepareGrid(model, options);
    this.#placeMicrophone(model, resolveMicrophone(options.microphone));
    this.noiseArc = -1;
    this.noiseLinks = new Int32Array(0);
    this.noiseSigns = new Float64Array(0);
    this.velumArea = 0;
    this.sourceState = 0;
    this.noiseState = 0;
    this.burstInput = 0;
    this.burstState = 0;
    /** Mean pressure of the source cells after the last two steps. */
    this.glottisPressure = 0;
    this.previousGlottisPressure = 0;
    /**
     * The last glottal flow and the pressure (per unit flow, 1/cm²) it
     * added to the mean of the source cells (see glottalLoad).
     */
    this.lastGlottalFlow = 0;
    this.sourceGain = 0;
    this.leak = 1 - this.dt / MICROPHONE_LEAK_TIME;
    this.tubeAreas = [null, null];
    this.pending = [];
    this.gpu = options.device ? new FdtdGpu(this, options.device) : null;
  }

  #prepareGrid(model, options) {
    // A microphone away from the lips needs the 1/r fall-off of the
    // radiated wave; the default keeps the plane-wave shell.
    const spherical =
      options.microphone && !model.enclosure
        ? withSphericalBoundary(model)
        : null;
    const grid = spherical?.model ?? model;
    // On the GPU the CPU arrays only hold the coefficients.
    this.#allocate(grid, options.device ? 'js' : (options.kernel ?? 'wasm'));
    this.#prepareBoundaries(grid);
    this.microphoneGain =
      spherical || model.enclosure ? SPHERICAL_MICROPHONE_GAIN : 1;
    if (spherical) {
      this.conductance.set(spherical.conductance, spherical.first);
      this.keep[spherical.ghost] = 0;
      this.gain[spherical.ghost] = 0;
    }
  }

  #allocate(model, kernel) {
    const cellCount = model.cells.length;
    const linkCount = model.links.a.length;
    this.cellCount = cellCount;
    this.linkCount = linkCount;
    this.kernel = kernel === 'wasm' ? createKernel(linkCount, cellCount) : null;
    const arrays = this.kernel?.arrays;
    const array = (name, Type, count) => arrays?.[name] ?? new Type(count);
    this.pressure = array('pressure', Float64Array, cellCount);
    this.divergence = array('divergence', Float64Array, cellCount);
    this.fill = new Float64Array(cellCount).fill(1);
    this.cellArea = new Float64Array(cellCount);
    this.keep = array('keep', Float64Array, cellCount).fill(1);
    this.gain = array('gain', Float64Array, cellCount).fill(COURANT);
    this.cellKind = Uint8Array.from(model.cells, (cell) => cell.kind);
    this.cellArc = Float64Array.from(model.cells, (cell) => cell.arc);
    this.envelope = envelopeAreas(model);
    // Envelope seen by the area function: smaller in the teeth slot cells.
    this.effective = Float64Array.from(this.envelope);
    this.opening = model.opening ?? null;
    this.teethCell = new Uint8Array(cellCount);
    // Share of each teeth cell that lies in the slot between the incisors.
    this.openness = new Float64Array(cellCount).fill(1);
    for (const cell of model.teeth?.cells ?? []) {
      this.teethCell[cell] = 1;
    }
    this.solid = new Uint8Array(cellCount);
    this.teethGap = null;
    this.velocity = array('velocity', Float64Array, linkCount);
    this.conductance = array('conductance', Float64Array, linkCount).fill(1);
    this.damping = array('damping', Float64Array, linkCount).fill(1);
    this.linkA = Int32Array.from(model.links.a);
    this.linkB = Int32Array.from(model.links.b);
    if (arrays) {
      // The wasm kernel addresses cells by byte offset.
      arrays.linkA.set(this.linkA.map((cell) => cell * 8));
      arrays.linkB.set(this.linkB.map((cell) => cell * 8));
    }
    this.linkKind = Uint8Array.from(model.links.kind);
    this.#indexLinks();
    const outputLinks = [];
    this.velumLinks = [];
    for (let link = 0; link < linkCount; link++) {
      const kind = this.linkKind[link];
      if (kind === LINK_LIPS || kind === LINK_NOSTRILS) {
        outputLinks.push(link);
      } else if (kind === LINK_VELUM) {
        this.velumLinks.push(link);
      }
    }
    this.outputLinks = Int32Array.from(outputLinks);
    // Positive when the link points from the tube out into the free air.
    this.outputSigns = Float64Array.from(outputLinks, (link) =>
      this.cellKind[this.linkA[link]] === CELL_AIR ? -1 : 1
    );
    this.#placeGlottis(model);
    this.#placePouches(model);
    this.#closeLinks();
  }

  /**
   * Lower boundary: an absorbing glottis termination on the tract cells
   * within about a cell of the source plane. The plane sits at a whole
   * number of cells from the rest glottis, from the lowest place the tube
   * below reaches up to as far above; the cells of every place are listed
   * here (see setShape).
   */
  #placeGlottis(model) {
    const { dx } = model;
    const travel = Math.floor((model.larynxTravel ?? 0) / dx + 1e-9);
    const tract = [];
    model.cells.forEach((cell, index) => {
      if (cell.kind === CELL_TRACT) {
        tract.push(index);
      }
    });
    this.glottisTravel = travel;
    this.glottisPlaces = [];
    for (let rise = -travel; rise <= travel; rise++) {
      const arc = rise * dx;
      const sources = tract.filter(
        (index) =>
          this.cellArc[index] >= arc - dx / 2 &&
          this.cellArc[index] <= arc + 0.75 * dx
      );
      // At rise 0 the source cells reach down to the rest glottis cells.
      this.glottisPlaces.push({ rise, arc, sourceCells: sources });
    }
    // Cells that a place of the glottis may close.
    this.larynxCells = Int32Array.from(
      tract.filter((index) => this.cellArc[index] < (travel - 0.5) * dx)
    );
    this.rise = 0;
    this.placed = false;
    this.sourceCell = new Uint8Array(this.cellCount);
    this.sourceCells = this.glottisPlaces[travel].sourceCells;
    for (const index of this.sourceCells) {
      this.sourceCell[index] = 1;
    }
    for (const index of this.larynxCells) {
      this.solid[index] = this.cellArc[index] < -dx / 2 ? 1 : 0;
    }
  }

  /** Links with a solid end or shut carry no flow until #updateLinks. */
  #closeLinks() {
    for (let link = 0; link < this.linkCount; link++) {
      if (
        this.shut[link] ||
        this.solid[this.linkA[link]] ||
        this.solid[this.linkB[link]]
      ) {
        this.conductance[link] = 0;
        this.damping[link] = 0;
      }
    }
    this.#skipClosed();
  }

  /**
   * The voxel model lists the links of the cells the glottis may close
   * first, from the lowest (see orderLarynxLinks in voxel-model.js): the
   * run of links with a solid end there carries no flow (conductance,
   * damping and velocity 0), so the step loop starts after it.
   */
  #skipClosed() {
    const { linkA, linkB, solid, linkCount } = this;
    let from = 0;
    while (from < linkCount && (solid[linkA[from]] || solid[linkB[from]])) {
      from++;
    }
    this.activeFrom = from;
  }

  /** Arc of the source plane from the rest glottis (cm). */
  get glottisArc() {
    return this.rise * this.dx;
  }

  /** Length (cm) from the source plane to the lips. */
  get activeLength() {
    return this.model.lengths[CELL_TRACT] - this.glottisArc;
  }

  /**
   * Whole-cell place of the source plane for a tract of `length` cm (over
   * lengthScale, see VOWEL_LENGTH_SCALE_3D in vowel-space.js): the nearest,
   * kept until the length moves 0.15 cells past the middle between two
   * places, so a length near a boundary does not flip it.
   */
  #riseFor(length) {
    if (!(length > 0)) {
      return this.rise;
    }
    const target =
      (this.model.lengths[CELL_TRACT] - length / this.lengthScale) / this.dx;
    const nearest = Math.max(
      -this.glottisTravel,
      Math.min(this.glottisTravel, Math.round(target))
    );
    if (
      !this.placed ||
      Math.abs(target - this.rise) > 0.5 + GLOTTIS_HYSTERESIS
    ) {
      this.placed = true;
      return nearest;
    }
    return this.rise;
  }

  /**
   * Move the source plane to a place: the glottis admittance moves to its
   * cells, the cells below it close and those above open. Cells that open
   * or close start from rest (pressure 0, their links lose their flow in
   * #updateLinks). Returns false when the place did not change.
   */
  #setGlottis(rise) {
    if (rise === this.rise) {
      return false;
    }
    const { dx, glottisTravel: travel } = this;
    for (const index of this.sourceCells) {
      this.sourceCell[index] = 0;
      this.admittance[index] = this.baseAdmittance[index];
    }
    const place = this.glottisPlaces[rise + travel];
    this.rise = rise;
    this.sourceCells = place.sourceCells;
    this.#shareGlottis();
    for (const index of this.larynxCells) {
      const closed = this.cellArc[index] < place.arc - dx / 2 ? 1 : 0;
      if (closed !== this.solid[index]) {
        this.pressure[index] = 0;
        this.solid[index] = closed;
      }
    }
    this.#setPouches(rise);
    return true;
  }

  /**
   * The source cells span about one slice per dx of arc; share the glottis
   * admittance between the slices so the total matches.
   */
  #shareGlottis() {
    let slices = 0;
    for (const index of this.sourceCells) {
      slices += (this.dx * this.dx) / this.envelope[index];
    }
    for (const index of this.sourceCells) {
      this.sourceCell[index] = 1;
      this.admittance[index] =
        this.baseAdmittance[index] +
        this.glottisAdmittance / Math.max(1, slices);
    }
  }

  /**
   * Pouches hold their anatomical volume (area x depth) spread evenly over
   * their cells. They ride along with the larynx: at each place of the
   * glottis only that place's opening links (see movePouchOpenings in
   * voxel-model.js) carry flow, the others are shut. The tract cells at an
   * opening hold at least the pouch fill, so the opening is about as wide
   * as the pouch: a narrow neck would turn the pouch into a Helmholtz
   * resonator.
   */
  #placePouches(model) {
    const cubic = model.dx ** 3;
    const pouches = model.sinuses ?? [];
    const fills = new Map();
    for (const sinus of pouches) {
      const cells = [];
      model.cells.forEach((cell, index) => {
        if (cell.kind === CELL_SINUS && cell.tube === sinus.tube) {
          cells.push(index);
        }
      });
      const fill = Math.min(
        1,
        Math.max(MIN_FILL, (sinus.area * sinus.length) / (cells.length * cubic))
      );
      for (const index of cells) {
        this.fill[index] = fill;
      }
      fills.set(sinus.tube, fill);
    }
    const openings = [];
    for (let link = 0; link < this.linkCount; link++) {
      if (this.linkKind[link] === LINK_SINUS) {
        openings.push(link);
      }
    }
    this.sinusOpenings = Int32Array.from(openings);
    this.shut = new Uint8Array(this.linkCount);
    this.pouchPlaces = this.glottisPlaces.map((_, place) => {
      const links = new Set();
      const floors = new Map();
      for (const sinus of pouches) {
        const fill = fills.get(sinus.tube);
        for (const link of sinus.openings?.[place] ?? []) {
          links.add(link);
          const a = this.linkA[link];
          const tract = this.cellKind[a] === CELL_SINUS ? this.linkB[link] : a;
          floors.set(tract, Math.max(floors.get(tract) ?? 0, fill));
        }
      }
      return { links, floors: [...floors] };
    });
    this.#setPouches(this.rise);
  }

  /** Open the pouches into the tract at the place of the glottis. */
  #setPouches(rise) {
    const place = this.pouchPlaces[rise + this.glottisTravel];
    for (const link of this.sinusOpenings) {
      this.shut[link] = place.links.has(link) ? 0 : 1;
    }
    this.openingFloors = place.floors;
  }

  /**
   * True for the tract cells whose fill comes from the opening weights
   * (see openingTable): all but the teeth cells, which share the slot area
   * evenly, while the teeth are in place. Without teeth every cell of a
   * section has the same fill.
   */
  #ranked(index) {
    return (
      this.opening !== null &&
      this.teethGap !== null &&
      this.cellKind[index] === CELL_TRACT &&
      !this.teethCell[index]
    );
  }

  /**
   * Fill of a cell on a link that crosses a section narrower than the
   * cell's own. Ranked cells keep their open pattern and close in
   * proportion, so a link between two open cells never shuts because the
   * other cell's window ranks it lower.
   */
  #narrowedFill(index, narrowest) {
    if (this.#ranked(index)) {
      return (
        this.fill[index] *
        Math.min(1, narrowest / Math.max(this.cellArea[index], 1e-12))
      );
    }
    return this.#fillAt(index, narrowest);
  }

  /**
   * Opening scale c that fills a stretch of points to `area` cm² (see
   * openingTable in voxel-model.js): the points with the highest weights
   * saturate at 1 and the rest hold c times their weight.
   */
  #binScale(bin, area) {
    const { weights, shares, heads, tails } = this.opening.bins[bin];
    const target = area / this.opening.sample;
    const count = weights.length;
    if (count === 0) {
      return 0;
    }
    if (target >= heads[count]) {
      return Infinity;
    }
    // Largest k whose point saturates first at c = 1 / w[k].
    let low = -1;
    let high = count - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      const filled =
        heads[middle] + shares[middle] + tails[middle + 1] / weights[middle];
      if (filled <= target) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return (target - heads[low + 1]) / tails[low + 1];
  }

  /** Opening scale at `arc`, interpolated between stretches. */
  #scale(arc, area) {
    const { binLength, bins, origin = 0 } = this.opening;
    const last = bins.length - 1;
    const at = Math.min(last, Math.max(0, (arc - origin) / binLength - 0.5));
    const lower = Math.floor(at);
    const upper = Math.min(last, lower + 1);
    const low = this.#binScale(lower, area);
    const high = this.#binScale(upper, area);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0) {
      return Math.max(low, high);
    }
    return low * (high / low) ** (at - lower);
  }

  /** Mean fill min(1, c w) of the points of a tract cube. */
  #openShare(index, scale) {
    const { cellWeights, cellTails, per } = this.opening;
    if (scale === Infinity) {
      return 1;
    }
    const start = index * per;
    let low = 0;
    let high = per;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (scale * cellWeights[start + middle] >= 1) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return (low + scale * cellTails[index * (per + 1) + low]) / per;
  }

  #fillAt(index, area) {
    if (this.#ranked(index)) {
      return this.#openShare(index, this.#scale(this.cellArc[index], area));
    }
    return (
      this.openness[index] *
      Math.min(1, Math.max(0, area / this.effective[index]))
    );
  }

  /** Tube links and cells: only these change with the articulation. */
  #indexLinks() {
    const { linkA, linkB, linkCount, cellCount } = this;
    // Only links that touch a tube change with the articulation.
    const tubeLinks = [];
    for (let index = 0; index < linkCount; index++) {
      const a = this.cellKind[linkA[index]];
      const b = this.cellKind[linkB[index]];
      if (a !== CELL_AIR || b !== CELL_AIR) {
        tubeLinks.push(index);
      }
    }
    this.tubeLinks = Int32Array.from(tubeLinks);
    this.tubeCells = [CELL_TRACT, CELL_NOSE].map((kind) => {
      const cells = [];
      for (let index = 0; index < cellCount; index++) {
        if (this.cellKind[index] === kind) {
          cells.push(index);
        }
      }
      return Int32Array.from(cells);
    });
    this.spans = null;
  }

  /**
   * Receiver cell. With a microphone option, `microphoneDistance` tells the
   * listener how far from the lips the solver already carried the sound
   * (less than the microphone distance when it lies outside the domain)
   * and `simulatesEnclosure` that the walls are part of the simulation.
   */
  #placeMicrophone(model, microphone) {
    const { lips } = model.landmarks;
    const target = microphone
      ? microphonePosition(microphone, lips)
      : [lips[0], lips[1], lips[2] + 3];
    this.microphone = nearestAirCell(model.cells, target);
    if (this.output !== 'microphone') {
      return;
    }
    this.simulatesEnclosure = Boolean(model.enclosure);
    if (microphone) {
      const { point } = model.cells[this.microphone];
      const offset = Math.hypot(
        ...point.map((value, axis) => value - target[axis])
      );
      this.microphoneDistance =
        offset > this.dx
          ? Math.hypot(...point.map((value, axis) => value - lips[axis]))
          : microphone.distance;
    }
  }

  /** Per-cell boundary admittance (open faces of the air shell, glottis). */
  #prepareBoundaries(model) {
    this.admittance = new Float64Array(this.cellCount);
    const wall = model.boundaryAdmittance ?? 1;
    model.openFaces.forEach((faces, index) => {
      this.admittance[index] = faces * wall;
    });
    this.baseAdmittance = Float64Array.from(this.admittance);
    this.#shareGlottis();
    this.#updateCellCoefficients();
  }

  /**
   * Reflection of the glottis termination (glottalReflection of the head
   * by default); 1 makes it rigid. Recomputes the glottis admittance.
   * @param {number} reflection
   */
  setGlottalReflection(reflection) {
    this.glottisAdmittance = (1 - reflection) / (1 + reflection);
    this.#shareGlottis();
    this.#updateCellCoefficients(this.sourceCells);
  }

  /**
   * The vocal tract as the folds see it (issue 34), in the terms of a tube
   * (Waveguide.glottalLoad): the source cells answer a glottal flow s at
   * once with a pressure jump of s / area (area = air face area of the
   * source cells / (COURANT * keep)), and the rest of their mean pressure p
   * is what came back from the field, the incident wave (p - s / area) / 2
   * of the last step. Handing the folds that area lets them solve the
   * jump with the flow (interactiveFlow); taking p / 2 with an infinite
   * area instead feeds the jump of the last flow back one step late,
   * which is unstable with a wide glottis ([h]). In microphone output the
   * field holds the integrated source (#sourcePressure); the incident wave
   * undoes that integration so that it is a derivative as the source in
   * both outputs. Steps on the GPU are batched, so there is no load there.
   * The object is reused.
   * @returns {{incident: number, area: number}}
   */
  glottalLoad() {
    if (this.gpu) {
      throw new Error('The GPU solver has no glottal load (queued steps)');
    }
    this.load ??= { incident: 0, area: Infinity };
    let pressure = this.glottisPressure;
    if (this.output === 'microphone') {
      pressure =
        (pressure - this.leak * this.previousGlottisPressure) /
        (this.dx * MICROPHONE_GAIN);
    }
    const gain = this.sourceGain;
    this.load.incident = (pressure - gain * this.lastGlottalFlow) / 2;
    this.load.area = gain > 0 ? 1 / gain : Infinity;
    return this.load;
  }

  #updateCellCoefficients(cells = null) {
    this.version++;
    const count = cells ? cells.length : this.cellCount;
    for (let position = 0; position < count; position++) {
      const index = cells ? cells[position] : position;
      const half = (COURANT * this.admittance[index]) / 2;
      this.keep[index] = (1 - half) / (1 + half);
      this.gain[index] = COURANT / (this.fill[index] * (1 + half));
    }
  }

  /**
   * Time step in seconds (the solver runs at 1 / dt). With a tract shape
   * the step stretches with its length, as in the waveguide: the source
   * plane (see setShape) leaves the active part of the voxel tract within
   * half a cell of the length, and running the grid slower by length /
   * active length scales every distance of the grid by that ratio, so the
   * tract keeps its formants.
   * @param {{length?: number}} [shape]
   */
  stepDuration(shape) {
    const length = shape?.length;
    if (!(length > 0)) {
      return this.dt;
    }
    return (this.dt * length) / this.activeLength;
  }

  /** Returns false when the areas did not change since the last call. */
  #setTube(kind, areas, force = false) {
    const previous = this.tubeAreas[kind];
    if (!force && previous && previous.length === areas.length) {
      let same = true;
      for (let index = 0; index < areas.length && same; index++) {
        same = previous[index] === areas[index];
      }
      if (same) {
        return false;
      }
    }
    this.tubeAreas[kind] = Float64Array.from(areas);
    // The tract's area function maps onto its active part.
    const [start, length] =
      kind === CELL_TRACT
        ? [this.glottisArc, this.activeLength]
        : [0, this.model.lengths[kind]];
    for (const index of this.tubeCells[kind]) {
      const area = resample(areas, (this.cellArc[index] - start) / length);
      this.cellArea[index] = area;
      // A solid cell (the larynx extension below the source plane, a
      // closed tooth) keeps fill 1; its links carry no flow.
      this.fill[index] = this.solid[index]
        ? 1
        : Math.max(MIN_FILL, this.#fillAt(index, area));
    }
    if (kind === CELL_TRACT) {
      for (const [index, floor] of this.openingFloors) {
        this.fill[index] = Math.max(this.fill[index], floor);
      }
    }
    return true;
  }

  /**
   * Open the teeth cells that overlap the slot between the incisal edges
   * and make the rest solid. Returns false when the gap did not change.
   * @param {{gap: number}|null|undefined} teeth
   */
  #applyTeeth(teeth) {
    const gap = teeth && this.model.teeth ? teeth.gap : null;
    if (gap === this.teethGap) {
      return false;
    }
    this.teethGap = gap;
    const { cells, groups, edge, width } = this.model.teeth ?? {};
    if (!cells) {
      return true;
    }
    const open = this.#teethSlot(gap, edge, width);
    const totals = new Map();
    const opened = new Map();
    groups.forEach((group, position) => {
      totals.set(group, (totals.get(group) ?? 0) + 1);
      opened.set(group, (opened.get(group) ?? 0) + open[position]);
    });
    cells.forEach((cell, position) => {
      const group = groups[position];
      const share = opened.get(group) / totals.get(group);
      const solid = gap !== null && !open[position];
      if (solid && !this.solid[cell]) {
        this.pressure[cell] = 0;
      }
      this.solid[cell] = solid ? 1 : 0;
      this.openness[cell] = gap === null ? 1 : open[position];
      this.effective[cell] = this.envelope[cell] * (gap === null ? 1 : share);
    });
    return true;
  }

  /**
   * Share of each teeth cell's cross-section inside the slot between the
   * incisal edges (at least one open cell per slice), so the open cells
   * add up to the slot area at any grid size.
   */
  #teethSlot(gap, edge, width) {
    const { cells, groups } = this.model.teeth;
    const { dx } = this;
    const half = dx / 2;
    const open = new Float64Array(cells.length);
    const nearest = new Map();
    const overlap = (low, high) => Math.min(1, Math.max(0, high - low) / dx);
    cells.forEach((cell, position) => {
      const [x, y] = this.model.cells[cell].point;
      open[position] =
        overlap(Math.max(y - half, edge - gap), Math.min(y + half, edge)) *
        overlap(Math.max(x - half, -width / 2), Math.min(x + half, width / 2));
      const vertical = Math.max(y - half - edge, edge - gap - (y + half));
      const lateral = Math.abs(x) - half - width / 2;
      const distance = Math.max(vertical, 0) + Math.max(lateral, 0);
      const best = nearest.get(groups[position]);
      if (!best || distance < best.distance) {
        nearest.set(groups[position], { distance, position });
      }
    });
    for (const { position } of nearest.values()) {
      if (open[position] === 0) {
        open[position] = 1;
      }
    }
    return open;
  }

  /**
   * Section range [from, to] that each link spans along its tube. A link
   * may span several sections (e.g. round the pharynx bend) and must not
   * bypass a constriction between its two cells.
   */
  #linkSpans() {
    const counts = this.tubeAreas.map((areas) => areas?.length ?? 0);
    const { rise } = this;
    if (
      this.spans?.rise === rise &&
      this.spans.counts.every((n, i) => n === counts[i])
    ) {
      return this.spans;
    }
    const from = new Int32Array(this.linkCount).fill(-1);
    const to = new Int32Array(this.linkCount).fill(-1);
    for (const link of this.tubeLinks) {
      const a = this.linkA[link];
      const b = this.linkB[link];
      const kind = this.cellKind[a];
      if (this.linkKind[link] !== LINK_INNER || !counts[kind]) {
        continue;
      }
      const [start, length] =
        kind === CELL_TRACT
          ? [this.glottisArc, this.activeLength]
          : [0, this.model.lengths[kind]];
      const scale = counts[kind] / length;
      const last = counts[kind] - 1;
      const section = (arc) =>
        Math.min(last, Math.max(0, Math.floor((arc - start) * scale)));
      const arcA = this.cellArc[a];
      const arcB = this.cellArc[b];
      from[link] = section(Math.min(arcA, arcB));
      to[link] = section(Math.max(arcA, arcB));
    }
    this.spans = { counts, rise, from, to };
    return this.spans;
  }

  #updateLinks() {
    // boundaryLossFactor (the frequency-independent waveguide loss before
    // issue 36) is the attenuation per crossed waveguide section; a wave
    // crosses one section in (L / 44) / c seconds.
    const exponent =
      (SPEED_OF_SOUND * this.dt * LOSS_REFERENCE_SECTIONS) / this.activeLength;
    const { fill, effective: envelope, linkA, linkB, linkKind } = this;
    const { cellKind, solid, shut } = this;
    const { from, to } = this.#linkSpans();
    for (const link of this.tubeLinks) {
      const a = linkA[link];
      const b = linkB[link];
      if (solid[a] || solid[b] || shut[link]) {
        this.conductance[link] = 0;
        this.damping[link] = 0;
        this.velocity[link] = 0;
        continue;
      }
      let fillA = fill[a];
      let fillB = fill[b];
      let area = Math.min(fillA * envelope[a], fillB * envelope[b]);
      if (from[link] >= 0) {
        const areas = this.tubeAreas[cellKind[a]];
        // The sections the link spans are in series: their inertances
        // add, so a closed section shuts the link but a short narrow one
        // does not narrow the whole cell.
        let inverse = 0;
        for (let index = from[link]; index <= to[link]; index++) {
          inverse += 1 / Math.max(areas[index], 1e-12);
        }
        const narrowest = (to[link] - from[link] + 1) / inverse;
        fillA = Math.min(fillA, this.#narrowedFill(a, narrowest));
        fillB = Math.min(fillB, this.#narrowedFill(b, narrowest));
        area = Math.min(area, narrowest);
      }
      // Each cell holds half of the link: two inertances in series, so
      // the link opens by the harmonic mean of the two fills. The opening
      // of the lips and nostrils into the free air is the tube's own
      // cross-section.
      this.conductance[link] =
        linkKind[link] === LINK_LIPS || linkKind[link] === LINK_NOSTRILS
          ? Math.max(0, Math.min(fillA, fillB))
          : Math.max(0, (2 * fillA * fillB) / Math.max(fillA + fillB, 1e-12));
      const nasal = cellKind[a] === CELL_NOSE || cellKind[b] === CELL_NOSE;
      const wallLoss = nasal ? this.wallLoss * this.nasalLoss : this.wallLoss;
      this.damping[link] =
        Math.max(0, boundaryLossFactor(area, wallLoss)) ** exponent;
    }
    this.#scaleOpenings();
    this.#skipClosed();
    const portArea = this.velumLinks.length * this.dx * this.dx;
    const open = Math.min(1, this.velumArea / Math.max(portArea, 1e-9));
    for (const link of this.velumLinks) {
      this.conductance[link] = Math.min(this.conductance[link], open);
      if (open <= MIN_FILL) {
        this.conductance[link] = 0;
        this.velocity[link] = 0;
      }
    }
  }

  /**
   * Lips and nostrils open by the end area of their tube at any grid size:
   * the cubes at a tilted or partly covered end leave more or fewer faces
   * to the free air than the cross-section holds, so scale the opening
   * links of each tube until their conductances add up to that area.
   */
  #scaleOpenings() {
    const { outputLinks, conductance, linkKind, dx } = this;
    const totals = [0, 0];
    for (const link of outputLinks) {
      totals[linkKind[link] === LINK_LIPS ? 0 : 1] +=
        conductance[link] * dx * dx;
    }
    const scales = [CELL_TRACT, CELL_NOSE].map((kind, position) => {
      const area = this.tubeAreas[kind]?.at(-1) ?? 0;
      return area / Math.max(totals[position], 1e-12);
    });
    for (const link of outputLinks) {
      const scale = scales[linkKind[link] === LINK_LIPS ? 0 : 1];
      conductance[link] = Math.min(1, conductance[link] * scale);
    }
  }

  /**
   * Nasal tract cross-sections (fixed during speech).
   * @param {ArrayLike<number>} areas
   */
  setNose(areas) {
    if (this.#setTube(1, areas)) {
      this.#updateLinks();
      this.#updateCellCoefficients(this.tubeCells[1]);
    }
  }

  /**
   * Oral tract area function, velopharyngeal port and incisors.
   * @param {ArrayLike<number>} areas
   * @param {number} velumArea cm².
   * @param {number} [velumIndex] Unused: the voxel model has its own port.
   * @param {{gap: number}|null} [teeth] Incisor gap (cm), see tractShape;
   *   without it the teeth slices are plain tube.
   * @param {{length?: number}} [shape] The tract shape: its length places
   *   the source plane (the whole cell nearest to it, with a hysteresis
   *   of GLOTTIS_HYSTERESIS cells). Without it the plane stays.
   */
  setShape(areas, velumArea, velumIndex, teeth, shape) {
    const velum = Math.max(0, velumArea);
    const raised = this.#setGlottis(this.#riseFor(shape?.length));
    const moved = this.#applyTeeth(teeth) || raised;
    const changed = this.#setTube(CELL_TRACT, areas, moved) || moved;
    if (!changed && velum === this.velumArea) {
      return;
    }
    this.velumArea = velum;
    this.#updateLinks();
    this.#updateCellCoefficients(this.tubeCells[CELL_TRACT]);
    this.areaCount = areas.length;
  }

  #selectNoiseLinks(arc) {
    if (Math.abs(arc - this.noiseArc) < 1e-6) {
      return;
    }
    this.noiseArc = arc;
    this.noiseVersion++;
    const links = [];
    const signs = [];
    for (let link = 0; link < this.linkCount; link++) {
      if (this.linkKind[link] !== LINK_INNER) {
        continue;
      }
      const a = this.linkA[link];
      const b = this.linkB[link];
      if (this.cellKind[a] !== CELL_TRACT || this.cellKind[b] !== CELL_TRACT) {
        continue;
      }
      const arcA = this.cellArc[a];
      const arcB = this.cellArc[b];
      if (Math.min(arcA, arcB) < arc && Math.max(arcA, arcB) >= arc) {
        links.push(link);
        signs.push(Math.sign(arcB - arcA));
      }
    }
    this.noiseLinks = Int32Array.from(links);
    this.noiseSigns = Float64Array.from(signs);
  }

  /**
   * Velocity added to the noise links for a turbulence pressure `noise`
   * (integrated like the glottal source in microphone mode), after
   * selecting the links that cross the noise plane.
   */
  #noiseForce(noisePosition, noise) {
    let force = noise;
    if (this.output === 'microphone') {
      // Integrated like the glottal source (see #sourcePressure).
      this.noiseState = this.noiseState * this.leak + noise;
      force = this.noiseState * this.dx * MICROPHONE_GAIN;
    }
    if (force === 0) {
      return 0;
    }
    const sections = this.areaCount ?? 44;
    const arc =
      this.glottisArc + (noisePosition / sections) * this.activeLength;
    this.#selectNoiseLinks(arc);
    // A pressure jump across the noise plane enters the momentum equation.
    return COURANT * NOISE_GAIN * force;
  }

  /**
   * Burst transient of a stop as a pressure jump on the noise plane. The
   * flow derivative has a net integral (the change of the mean flow) that a
   * pressure jump would turn into lasting momentum in a lossless field, so
   * a DC blocker with the microphone leak (about 20 Hz) removes it.
   */
  #burst(flow) {
    this.burstState = flow - this.burstInput + this.leak * this.burstState;
    this.burstInput = flow;
    return this.burstState;
  }

  /** Pressure the glottal flow adds to the source cells (per keep). */
  #sourcePressure(glottalFlow) {
    let flow = glottalFlow;
    if (this.output === 'microphone') {
      // The microphone hears dp/dt of the radiated flow: integrate once.
      this.sourceState = this.sourceState * this.leak + glottalFlow;
      flow = this.sourceState * this.dx * MICROPHONE_GAIN;
    }
    // A volume velocity V raises the pressure of the cells it enters by
    // lambda * V / (air face area): sum of phi * dx² over the source cells.
    let area = 0;
    let keep = 0;
    for (const index of this.sourceCells) {
      area += this.fill[index] * this.dx * this.dx;
      keep += this.keep[index];
    }
    this.lastGlottalFlow = glottalFlow;
    this.sourceGain =
      (COURANT * keep) /
      (Math.max(area, 1e-3) * Math.max(1, this.sourceCells.length));
    return (COURANT * flow) / Math.max(area, 1e-3);
  }

  #measure() {
    if (this.output === 'microphone') {
      return this.pressure[this.microphone] * this.microphoneGain;
    }
    const { outputLinks, outputSigns, conductance, velocity } = this;
    let flow = 0;
    for (let index = 0; index < outputLinks.length; index++) {
      const link = outputLinks[index];
      flow += outputSigns[index] * conductance[link] * velocity[link];
    }
    return flow * this.dx * this.dx;
  }

  /**
   * Advance one time step.
   * @param {number} glottalFlow Source volume velocity (derivative).
   * @param {number} noisePosition Section boundary of the turbulence source.
   * @param {number} noise Turbulence pressure.
   * @param {number} [flow] Burst transient of a stop: the 3D field gets it
   *   through the noise source at the same place, without its DC.
   * @returns {number} Radiated output.
   */
  step(glottalFlow, noisePosition, noise, flow = 0) {
    if (this.gpu) {
      throw new Error('A GPU solver runs queued steps (queueStep)');
    }
    const force = this.#noiseForce(noisePosition, noise + this.#burst(flow));
    if (force !== 0) {
      for (let index = 0; index < this.noiseLinks.length; index++) {
        this.velocity[this.noiseLinks[index]] += force * this.noiseSigns[index];
      }
    }
    if (this.kernel) {
      this.kernel.step(this.activeFrom);
    } else {
      this.#stepJs();
    }
    const pressure = this.#sourcePressure(glottalFlow);
    let sum = 0;
    for (const index of this.sourceCells) {
      this.pressure[index] += pressure * this.keep[index];
      sum += this.pressure[index];
    }
    this.previousGlottisPressure = this.glottisPressure;
    this.glottisPressure = sum / Math.max(1, this.sourceCells.length);
    return this.#measure();
  }

  /**
   * Queue a step (arguments as for step); flushSteps returns the outputs.
   * On the CPU the step runs right away, on the GPU with the next flush.
   */
  queueStep(glottalFlow, noisePosition, noise, flow = 0) {
    if (!this.gpu) {
      this.pending.push(this.step(glottalFlow, noisePosition, noise, flow));
      return;
    }
    const force = this.#noiseForce(noisePosition, noise + this.#burst(flow));
    this.gpu.queue(force, this.#sourcePressure(glottalFlow));
  }

  /**
   * Outputs of the steps queued since the last flush. With `field` on the
   * GPU, field() then holds the RMS pressure over these steps (on the CPU
   * it is always the current pressure).
   * @param {{field?: boolean}} [options]
   * @returns {Promise<Float64Array>}
   */
  flushSteps(options = {}) {
    if (this.gpu) {
      return this.gpu.flush(options);
    }
    const outputs = Float64Array.from(this.pending);
    this.pending = [];
    return Promise.resolve(outputs);
  }

  /** Reference step loop; the wasm kernel mirrors it operation by operation. */
  #stepJs() {
    const { pressure, velocity, damping, conductance, linkA, linkB } = this;
    const { divergence, keep, gain, linkCount, cellCount } = this;
    for (let link = this.activeFrom; link < linkCount; link++) {
      const a = linkA[link];
      const b = linkB[link];
      const u =
        damping[link] *
        (velocity[link] - COURANT * (pressure[b] - pressure[a]));
      velocity[link] = u;
      const flux = conductance[link] * u;
      divergence[a] += flux;
      divergence[b] -= flux;
    }
    for (let index = 0; index < cellCount; index++) {
      pressure[index] =
        keep[index] * pressure[index] - gain[index] * divergence[index];
      divergence[index] = 0;
    }
  }

  /**
   * Pressure in every cell, for visualisation.
   * @returns {{positions: Float32Array, pressure: Float64Array, kinds: Uint8Array}}
   */
  field() {
    this.positions ??= Float32Array.from(
      this.model.cells.flatMap((cell) => cell.point)
    );
    const count = this.model.cells.length;
    return {
      positions: this.positions,
      pressure: this.pressure.subarray(0, count),
      kinds: this.cellKind.subarray(0, count),
    };
  }

  reset() {
    this.pressure.fill(0);
    this.velocity.fill(0);
    this.sourceState = 0;
    this.noiseState = 0;
    this.burstInput = 0;
    this.burstState = 0;
    this.glottisPressure = 0;
    this.previousGlottisPressure = 0;
    this.lastGlottalFlow = 0;
    this.gpu?.reset();
  }
}
