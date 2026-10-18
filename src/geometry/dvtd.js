/**
 * Vocal tract surfaces of the Dresden Vocal Tract Dataset (Birkholz,
 * Kürbis, Stone, Häsner, Blandin and Fleischer 2020, "Printable 3D vocal
 * tract shapes from MRI data and their acoustic and aerodynamic
 * properties", Scientific Data 7, 255; CC0): inner surfaces in
 * millimetres with +z superior, +y anterior and x lateral, open at the
 * glottis and at the lips.
 *
 * `tractAreaFunction` turns such a surface into the area function the
 * tube and 3D solvers use, and `vvtfPeaks` reads the resonances of the
 * dataset's finite-element transfer functions, so the model can be
 * checked against measured anatomy and its simulated acoustics.
 */

import { areaFunction, tractOpenings } from './tract-analysis.js';
import {
  capLoops,
  medialPath,
  voxelizeMesh,
  wallDistance,
} from './voxelize.js';

/** Superior direction of the dataset's coordinates. */
export const DVTD_UP = [0, 0, 1];

/** Speed of sound of the dataset's finite-element simulations (cm/s). */
export const DVTD_SPEED_OF_SOUND = 34500;

/**
 * Centreline and area function of an open tract surface, from the
 * glottis cut to the lip cut.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {{dx?: number, step?: number, window?: number, up?: number[]}} [options]
 *   Voxel size and section step in mesh units (1 and 2.5 for millimetres),
 *   smoothing window of the medial path in voxels, and the superior
 *   direction.
 * @returns {{points: number[][], directions: number[][], areas: number[],
 *   distances: number[], length: number, glottis: number[], lips: number[]}}
 */
export function tractAreaFunction(mesh, options = {}) {
  const openings = tractOpenings(mesh, options.up ?? DVTD_UP);
  const grid = voxelizeMesh(capLoops(mesh), { dx: options.dx ?? 1 });
  const path = medialPath(
    grid,
    wallDistance(grid),
    openings.glottis.center,
    openings.lips.center
  );
  return {
    ...areaFunction(
      mesh,
      [openings.glottis.center, ...path, openings.lips.center],
      { step: options.step ?? 2.5, window: options.window ?? 7 }
    ),
    glottis: openings.glottis.center,
    lips: openings.lips.center,
  };
}

/**
 * Resonance frequencies of a `*-vvtf-calculated.txt` transfer function
 * (columns: frequency in Hz, magnitude, phase): local maxima of the
 * magnitude over three samples on each side.
 * @param {string} text
 * @param {number} [maxFrequency]
 * @returns {number[]}
 */
export function vvtfPeaks(text, maxFrequency = 5000) {
  const rows = text
    .split('\n')
    .filter((line) => /^\s*[\d.]/.test(line))
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row[0] <= maxFrequency);
  const peaks = [];
  for (let index = 3; index < rows.length - 3; index++) {
    const magnitude = rows[index][1];
    // Strictly above the previous sample, so a flat top counts once.
    if (
      rows[index][0] > 100 &&
      rows[index - 1][1] < magnitude &&
      rows.slice(index - 3, index + 4).every((row) => row[1] <= magnitude)
    ) {
      peaks.push(Math.round(rows[index][0]));
    }
  }
  return peaks;
}
