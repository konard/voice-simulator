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
 * The voxel tract has the head's rest vocal tract length; the dynamic
 * length of the larynx and lips stretches the time step instead (see
 * stepDuration). Simplifications: that stretch scales the nose and the
 * air around the head with the tract, and wall losses use the same
 * empirical loss model as the 1D waveguide, converted to a loss per unit
 * of time.
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

import { LOSS_REFERENCE_SECTIONS, lossFactor } from './waveguide.js';
import { SPEED_OF_SOUND } from './transfer.js';
import { glottalReflection } from './glottis.js';
import {
  CELL_AIR,
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
    // Lower boundary: absorbing glottis termination on the first tract cells.
    this.sourceCells = [];
    model.cells.forEach((cell, index) => {
      if (cell.kind === CELL_TRACT && cell.arc <= 0.75 * model.dx) {
        this.sourceCells.push(index);
      }
    });
    this.#fillSinuses(model);
  }

  /**
   * Pouches hold their anatomical volume (area x depth) spread evenly over
   * their cells. The tract cells at a pouch opening hold at least the
   * pouch fill, so the opening is about as wide as the pouch: a narrow
   * neck would turn the pouch into a Helmholtz resonator.
   */
  #fillSinuses(model) {
    const cubic = model.dx ** 3;
    for (const sinus of model.sinuses ?? []) {
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
    }
    const floors = new Map();
    for (let link = 0; link < this.linkCount; link++) {
      if (this.linkKind[link] === LINK_SINUS) {
        const [tract, sinus] =
          this.cellKind[this.linkA[link]] === CELL_SINUS
            ? [this.linkB[link], this.linkA[link]]
            : [this.linkA[link], this.linkB[link]];
        floors.set(tract, Math.max(floors.get(tract) ?? 0, this.fill[sinus]));
      }
    }
    this.openingFloors = [...floors];
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
    const { binLength, bins } = this.opening;
    const last = bins.length - 1;
    const at = Math.min(last, Math.max(0, arc / binLength - 0.5));
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
    this.tubeCells = [CELL_TRACT, 1].map((kind) => {
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
    // The source cells span about one slice per dx of arc; share the
    // glottis admittance between the slices so the total matches.
    let slices = 0;
    for (const index of this.sourceCells) {
      slices += (this.dx * this.dx) / this.envelope[index];
    }
    for (const index of this.sourceCells) {
      this.admittance[index] = this.glottisAdmittance / Math.max(1, slices);
    }
    this.#updateCellCoefficients();
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
   * the step stretches with its length, as in the waveguide: the voxel
   * tract has the rest length, and running it slower by length / rest
   * length scales every distance of the grid by that ratio, so a
   * protruded or lowered tract keeps its formants.
   * @param {{length?: number}} [shape]
   */
  stepDuration(shape) {
    const length = shape?.length;
    if (!(length > 0)) {
      return this.dt;
    }
    return (this.dt * length) / this.model.lengths[CELL_TRACT];
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
    const length = this.model.lengths[kind];
    for (const index of this.tubeCells[kind]) {
      const area = resample(areas, this.cellArc[index] / length);
      this.cellArea[index] = area;
      this.fill[index] = Math.max(MIN_FILL, this.#fillAt(index, area));
      if (this.solid[index]) {
        this.fill[index] = 1;
      }
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
    if (this.spans && this.spans.counts.every((n, i) => n === counts[i])) {
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
      const scale = counts[kind] / this.model.lengths[kind];
      const last = counts[kind] - 1;
      const arcA = this.cellArc[a];
      const arcB = this.cellArc[b];
      from[link] = Math.min(last, Math.floor(Math.min(arcA, arcB) * scale));
      to[link] = Math.min(last, Math.floor(Math.max(arcA, arcB) * scale));
    }
    this.spans = { counts, from, to };
    return this.spans;
  }

  #updateLinks() {
    // lossFactor is the attenuation per crossed waveguide section; a wave
    // crosses one section in (L / 44) / c seconds.
    const exponent =
      (SPEED_OF_SOUND * this.dt * LOSS_REFERENCE_SECTIONS) /
      this.model.lengths[CELL_TRACT];
    const { fill, effective: envelope, linkA, linkB, cellKind, solid } = this;
    const { from, to } = this.#linkSpans();
    for (const link of this.tubeLinks) {
      const a = linkA[link];
      const b = linkB[link];
      if (solid[a] || solid[b]) {
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
      // the link opens by the harmonic mean of the two fills.
      this.conductance[link] = Math.max(
        0,
        (2 * fillA * fillB) / Math.max(fillA + fillB, 1e-12)
      );
      this.damping[link] =
        Math.max(0, lossFactor(area, this.wallLoss)) ** exponent;
    }
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
   */
  setShape(areas, velumArea, velumIndex, teeth) {
    const velum = Math.max(0, velumArea);
    const moved = this.#applyTeeth(teeth);
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
    const arc = (noisePosition / sections) * this.model.lengths[CELL_TRACT];
    this.#selectNoiseLinks(arc);
    // A pressure jump across the noise plane enters the momentum equation.
    return COURANT * NOISE_GAIN * force;
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
    for (const index of this.sourceCells) {
      area += this.fill[index] * this.dx * this.dx;
    }
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
   * @returns {number} Radiated output.
   */
  step(glottalFlow, noisePosition, noise) {
    if (this.gpu) {
      throw new Error('A GPU solver runs queued steps (queueStep)');
    }
    const force = this.#noiseForce(noisePosition, noise);
    if (force !== 0) {
      for (let index = 0; index < this.noiseLinks.length; index++) {
        this.velocity[this.noiseLinks[index]] += force * this.noiseSigns[index];
      }
    }
    if (this.kernel) {
      this.kernel.step();
    } else {
      this.#stepJs();
    }
    const pressure = this.#sourcePressure(glottalFlow);
    for (const index of this.sourceCells) {
      this.pressure[index] += pressure * this.keep[index];
    }
    return this.#measure();
  }

  /**
   * Queue a step (arguments as for step); flushSteps returns the outputs.
   * On the CPU the step runs right away, on the GPU with the next flush.
   */
  queueStep(glottalFlow, noisePosition, noise) {
    if (!this.gpu) {
      this.pending.push(this.step(glottalFlow, noisePosition, noise));
      return;
    }
    const force = this.#noiseForce(noisePosition, noise);
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
    for (let link = 0; link < linkCount; link++) {
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
    this.gpu?.reset();
  }
}
