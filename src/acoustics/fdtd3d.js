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
 * Simplifications: the voxel tract has the head's rest vocal tract length
 * (dynamic lengthening by the larynx or lips only rescales the area
 * function), and wall losses use the same empirical loss model as the 1D
 * waveguide, converted to a loss per unit of time.
 */

import { lossFactor } from './waveguide.js';
import { SPEED_OF_SOUND } from './transfer.js';
import {
  CELL_AIR,
  CELL_TRACT,
  LINK_INNER,
  LINK_LIPS,
  LINK_NOSTRILS,
  LINK_VELUM,
  buildVoxelModel,
} from './voxel-model.js';

const COURANT = 0.5;
const MIN_FILL = 1e-4;
/** Glottis termination admittance (reflection 0.75, like the waveguide). */
const GLOTTIS_ADMITTANCE = 1 / 7;
/** Waveguide sections that the empirical loss model is calibrated for. */
const LOSS_REFERENCE_SECTIONS = 44;
/**
 * Microphone level per cm of cell size: matches the waveguide output level
 * for the same source (the radiated pressure is sampled at one point).
 */
const MICROPHONE_GAIN = 3.9;
/** Time constant of the leaky source integrator in microphone mode (s). */
const MICROPHONE_LEAK_TIME = 0.008;
const NOISE_GAIN = 1.5;

function resample(values, position) {
  const source = Math.max(
    0,
    Math.min(values.length - 1, position * values.length - 0.5)
  );
  const lower = Math.floor(source);
  const upper = Math.min(values.length - 1, lower + 1);
  return values[lower] + (values[upper] - values[lower]) * (source - lower);
}

/**
 * Cross-section of the envelope at each tube cell. Cells of a tube form
 * slices about `dx` apart in arc length; a triangular kernel of half-width
 * 2 dx sums to exactly one slice per dx, so the weighted count times dx²
 * is the voxelised cross-section.
 */
function envelopeAreas(model) {
  const { cells, dx } = model;
  const reach = 2 * dx;
  const areas = new Float64Array(cells.length).fill(dx * dx);
  const byKind = [[], []];
  cells.forEach((cell, index) => {
    if (cell.kind !== CELL_AIR) {
      byKind[cell.kind].push(index);
    }
  });
  for (const members of byKind) {
    const sorted = members.sort((a, b) => cells[a].arc - cells[b].arc);
    let low = 0;
    for (const index of sorted) {
      const arc = cells[index].arc;
      while (cells[sorted[low]].arc < arc - reach) {
        low++;
      }
      let weight = 0;
      for (let other = low; other < sorted.length; other++) {
        const distance = Math.abs(cells[sorted[other]].arc - arc);
        if (cells[sorted[other]].arc > arc + reach) {
          break;
        }
        weight += 1 - distance / reach;
      }
      areas[index] = (weight * dx ** 3) / reach;
    }
  }
  return areas;
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
   * @param {{head?: object, dx?: number, model?: object, output?: 'flow'|'microphone'}} [options]
   */
  constructor(options = {}) {
    const model = options.model ?? buildVoxelModel(options.head, options);
    this.model = model;
    this.dx = model.dx;
    this.dt = (COURANT * model.dx) / SPEED_OF_SOUND;
    this.output = options.output ?? 'flow';
    this.#allocate(model);
    this.#prepareBoundaries(model);
    const { lips } = model.landmarks;
    this.microphone = nearestAirCell(model.cells, [
      lips[0],
      lips[1],
      lips[2] + 3,
    ]);
    this.noiseArc = -1;
    this.noiseLinks = new Int32Array(0);
    this.noiseSigns = new Float64Array(0);
    this.velumArea = 0;
    this.sourceState = 0;
    this.noiseState = 0;
    this.leak = 1 - this.dt / MICROPHONE_LEAK_TIME;
    this.tubeAreas = [null, null];
  }

  #allocate(model) {
    const cellCount = model.cells.length;
    const linkCount = model.links.a.length;
    this.cellCount = cellCount;
    this.linkCount = linkCount;
    this.pressure = new Float64Array(cellCount);
    this.divergence = new Float64Array(cellCount);
    this.fill = new Float64Array(cellCount).fill(1);
    this.keep = new Float64Array(cellCount).fill(1);
    this.gain = new Float64Array(cellCount).fill(COURANT);
    this.cellKind = Uint8Array.from(model.cells, (cell) => cell.kind);
    this.cellArc = Float64Array.from(model.cells, (cell) => cell.arc);
    this.envelope = envelopeAreas(model);
    this.velocity = new Float64Array(linkCount);
    this.conductance = new Float64Array(linkCount).fill(1);
    this.damping = new Float64Array(linkCount).fill(1);
    this.linkA = Int32Array.from(model.links.a);
    this.linkB = Int32Array.from(model.links.b);
    this.linkKind = Uint8Array.from(model.links.kind);
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
  }

  /** Per-cell boundary admittance (open faces of the air shell, glottis). */
  #prepareBoundaries(model) {
    this.admittance = new Float64Array(this.cellCount);
    model.openFaces.forEach((faces, index) => {
      this.admittance[index] = faces;
    });
    // The source cells span about one slice per dx of arc; share the
    // glottis admittance between the slices so the total matches.
    let slices = 0;
    for (const index of this.sourceCells) {
      slices += (this.dx * this.dx) / this.envelope[index];
    }
    for (const index of this.sourceCells) {
      this.admittance[index] = GLOTTIS_ADMITTANCE / Math.max(1, slices);
    }
    this.#updateCellCoefficients();
  }

  #updateCellCoefficients() {
    for (let index = 0; index < this.cellCount; index++) {
      const half = (COURANT * this.admittance[index]) / 2;
      this.keep[index] = (1 - half) / (1 + half);
      this.gain[index] = COURANT / (this.fill[index] * (1 + half));
    }
  }

  /** Time step in seconds (the solver runs at 1 / dt). */
  stepDuration() {
    return this.dt;
  }

  #setTube(kind, areas) {
    this.tubeAreas[kind] = Float64Array.from(areas);
    const length = this.model.lengths[kind];
    for (let index = 0; index < this.cellCount; index++) {
      if (this.cellKind[index] !== kind) {
        continue;
      }
      const area = resample(areas, this.cellArc[index] / length);
      this.fill[index] = Math.min(
        1,
        Math.max(MIN_FILL, area / this.envelope[index])
      );
    }
  }

  /** Smallest tube area between the arc positions of two cells. */
  #narrowest(a, b) {
    const kind = this.cellKind[a];
    const areas = this.tubeAreas[kind];
    if (!areas) {
      return Infinity;
    }
    const scale = areas.length / this.model.lengths[kind];
    const last = areas.length - 1;
    const arcA = this.cellArc[a];
    const arcB = this.cellArc[b];
    const from = Math.min(last, Math.floor(Math.min(arcA, arcB) * scale));
    const to = Math.min(last, Math.floor(Math.max(arcA, arcB) * scale));
    let narrowest = Infinity;
    for (let index = from; index <= to; index++) {
      narrowest = Math.min(narrowest, areas[index]);
    }
    return narrowest;
  }

  #updateLinks() {
    // lossFactor is the attenuation per crossed waveguide section; a wave
    // crosses one section in (L / 44) / c seconds.
    const exponent =
      (SPEED_OF_SOUND * this.dt * LOSS_REFERENCE_SECTIONS) /
      this.model.lengths[CELL_TRACT];
    const { fill, envelope, linkA, linkB } = this;
    for (let link = 0; link < this.linkCount; link++) {
      const a = linkA[link];
      const b = linkB[link];
      let g = Math.min(fill[a], fill[b]);
      if (this.cellKind[a] === CELL_AIR && this.cellKind[b] === CELL_AIR) {
        this.conductance[link] = g;
        continue;
      }
      let area = Math.min(fill[a] * envelope[a], fill[b] * envelope[b]);
      if (this.linkKind[link] === LINK_INNER) {
        // A link may span several sections (e.g. round the pharynx bend):
        // it must not bypass a constriction between its two cells.
        const narrowest = this.#narrowest(a, b);
        g = Math.min(g, narrowest / Math.max(envelope[a], envelope[b]));
        area = Math.min(area, narrowest);
      }
      this.conductance[link] = Math.max(0, g);
      this.damping[link] = Math.max(0, lossFactor(area)) ** exponent;
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
    this.#setTube(1, areas);
    this.#updateLinks();
    this.#updateCellCoefficients();
  }

  /**
   * Oral tract area function and velopharyngeal port.
   * @param {ArrayLike<number>} areas
   * @param {number} velumArea cm².
   */
  setShape(areas, velumArea) {
    this.#setTube(CELL_TRACT, areas);
    this.velumArea = Math.max(0, velumArea);
    this.#updateLinks();
    this.#updateCellCoefficients();
    this.areaCount = areas.length;
  }

  #selectNoiseLinks(arc) {
    if (Math.abs(arc - this.noiseArc) < 1e-6) {
      return;
    }
    this.noiseArc = arc;
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

  #addNoise(noisePosition, noise) {
    const sections = this.areaCount ?? 44;
    const arc = (noisePosition / sections) * this.model.lengths[CELL_TRACT];
    this.#selectNoiseLinks(arc);
    // A pressure jump across the noise plane enters the momentum equation.
    const force = COURANT * NOISE_GAIN * noise;
    for (let index = 0; index < this.noiseLinks.length; index++) {
      this.velocity[this.noiseLinks[index]] += force * this.noiseSigns[index];
    }
  }

  #injectSource(glottalFlow) {
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
    const pressure = (COURANT * flow) / Math.max(area, 1e-3);
    for (const index of this.sourceCells) {
      this.pressure[index] += pressure * this.keep[index];
    }
  }

  #measure() {
    if (this.output === 'microphone') {
      return this.pressure[this.microphone];
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
    let force = noise;
    if (this.output === 'microphone') {
      // Integrated like the glottal source (see #injectSource).
      this.noiseState = this.noiseState * this.leak + noise;
      force = this.noiseState * this.dx * MICROPHONE_GAIN;
    }
    if (force !== 0) {
      this.#addNoise(noisePosition, force);
    }
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
    this.#injectSource(glottalFlow);
    return this.#measure();
  }

  /**
   * Pressure in every cell, for visualisation.
   * @returns {{positions: Float32Array, pressure: Float64Array, kinds: Uint8Array}}
   */
  field() {
    this.positions ??= Float32Array.from(
      this.model.cells.flatMap((cell) => cell.point)
    );
    return {
      positions: this.positions,
      pressure: this.pressure,
      kinds: this.cellKind,
    };
  }

  reset() {
    this.pressure.fill(0);
    this.velocity.fill(0);
    this.sourceState = 0;
    this.noiseState = 0;
  }
}
