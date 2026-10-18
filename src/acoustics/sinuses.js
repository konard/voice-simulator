/**
 * Blind side pouches of the lower pharynx for the 3D voxel model (issue 9):
 * the left and right piriform fossae beside the larynx tube and the
 * vallecula in front of the epiglottis. Each pouch is a short tube of its
 * own that opens into the vocal tract only at its upper end; everywhere
 * else a wall separates it from the tract. Its quarter-wave resonance
 * puts an antiresonance into every vowel: about 4-5 kHz for the 2 cm deep
 * piriform fossae (Dang & Honda 1997; Takemoto et al. 2010) and higher for
 * the shallower vallecula. The 1D waveguide models the fossae as one side
 * branch with the same depth and opening (see waveguide.js).
 *
 * Positions follow the tract centreline in the head frame (cm): the
 * pharynx is vertical there, +x is lateral and the local normal of the
 * centreline points to the posterior pharyngeal wall.
 */

import {
  PIRIFORM_AREA,
  PIRIFORM_HEIGHT,
  PIRIFORM_LENGTH,
  REST_LENGTH,
} from './waveguide.js';
import { arcPoint } from '../geometry/centerline.js';

/** Centre of each piriform fossa from the midline (cm, adult). */
const PIRIFORM_LATERAL = 1.3;
/** Shift of the fossae towards the posterior pharyngeal wall (cm). */
const PIRIFORM_POSTERIOR = 0.2;
/** Vallecula: opening above the glottis, depth and opening (cm, cm²). */
export const VALLECULA_HEIGHT = 3.6;
export const VALLECULA_DEPTH = 1;
export const VALLECULA_AREA = 0.6;
/** Centre of the vallecula in front of the tract centreline (cm). */
const VALLECULA_FORWARD = 1.1;
const PATH_STEP = 0.1;

function largestMajor(tract, from, to) {
  let major = 0;
  for (let index = 0; index < tract.count; index++) {
    const arc = (index + 0.5) * tract.sectionLength;
    if (arc >= from && arc <= to) {
      major = Math.max(major, tract.axes[index * 2]);
    }
  }
  return major;
}

function largestMinor(tract, from, to) {
  let minor = 0;
  for (let index = 0; index < tract.count; index++) {
    const arc = (index + 0.5) * tract.sectionLength;
    if (arc >= from && arc <= to) {
      minor = Math.max(minor, tract.axes[index * 2 + 1]);
    }
  }
  return minor;
}

/**
 * A pouch that runs from `entry` cm of tract arc down to `entry - depth`,
 * offset from the tract centreline by `side` cm laterally (x) and
 * `posterior` cm along the centreline normal.
 */
function pouch(tract, { name, entry, depth, area, side, posterior, dx }) {
  const radius = Math.sqrt(area / Math.PI);
  // At least half a cell so every slice of the pouch holds a voxel.
  const envelope = Math.max(radius, dx / 2);
  const count = Math.max(2, Math.ceil(depth / PATH_STEP));
  const points = new Float64Array(count * 3);
  const tangents = new Float64Array(count * 3);
  const centre = (distance) => {
    const { point, tangent } = arcPoint(
      Math.max(0, entry - distance),
      tract.layout
    );
    const normal = [0, tangent[2], -tangent[1]];
    return [
      point[0] + side,
      point[1] + normal[1] * posterior,
      point[2] + normal[2] * posterior,
    ];
  };
  for (let index = 0; index < count; index++) {
    const distance = ((index + 0.5) / count) * depth;
    const point = centre(distance);
    const next = centre(distance + PATH_STEP / 2);
    const previous = centre(distance - PATH_STEP / 2);
    const direction = next.map((value, axis) => value - previous[axis]);
    const norm = Math.hypot(...direction) || 1;
    points.set(point, index * 3);
    tangents.set(
      direction.map((value) => value / norm),
      index * 3
    );
  }
  return {
    name,
    points,
    tangents,
    count,
    length: depth,
    sectionLength: depth / count,
    axes: new Float64Array(count * 2).fill(envelope),
    entry,
    area,
  };
}

/**
 * Pouch tubes for a head (without kind; see buildVoxelModel).
 * @param {{points: Float64Array, axes: Float64Array, count: number, sectionLength: number, layout: object}} tract
 *   Tract tube with its envelope semi-axes.
 * @param {Record<string, number>} head Normalised head configuration.
 * @param {number} dx Cell size (cm).
 * @param {{piriform?: boolean, vallecula?: boolean}} [options]
 */
export function sinusTubes(tract, head, dx, options = {}) {
  const scale = head.vocalTractLength / REST_LENGTH;
  const tubes = [];
  if (options.piriform !== false) {
    const entry = PIRIFORM_HEIGHT * scale;
    const depth = PIRIFORM_LENGTH * scale;
    const area = (PIRIFORM_AREA / 2) * head.pharynxWidth;
    const envelope = Math.max(Math.sqrt(area / Math.PI), dx / 2);
    // Beside the larynx tube with half a cube to spare, so the cubes of the
    // fossa stay apart from it on coarse grids.
    const lateral = Math.max(
      PIRIFORM_LATERAL * scale * head.pharynxWidth,
      largestMajor(tract, entry - depth, entry + dx) + envelope + dx / 2
    );
    for (const [name, sign] of [
      ['piriform-left', 1],
      ['piriform-right', -1],
    ]) {
      tubes.push(
        pouch(tract, {
          name,
          entry,
          depth,
          area,
          side: sign * lateral,
          posterior: PIRIFORM_POSTERIOR * scale,
          dx,
        })
      );
    }
  }
  if (options.vallecula !== false) {
    const entry = VALLECULA_HEIGHT * scale;
    const depth = VALLECULA_DEPTH * scale;
    const area = VALLECULA_AREA * head.pharynxWidth;
    const envelope = Math.max(Math.sqrt(area / Math.PI), dx / 2);
    // In front of the tract with half a cube to spare, like the fossae: a
    // whole cube would leave no face between the pouch and the tract.
    const forward = Math.max(
      VALLECULA_FORWARD * scale,
      largestMinor(tract, entry - depth, entry + dx) + envelope + dx / 2
    );
    tubes.push(
      pouch(tract, {
        name: 'vallecula',
        entry,
        depth,
        area,
        side: 0,
        posterior: -forward,
        dx,
      })
    );
  }
  return tubes;
}
