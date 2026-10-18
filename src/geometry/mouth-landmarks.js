/**
 * Key points of the mouth found the way they are read off a midsagittal
 * MRI slice, so the procedural articulators and any segmented or modelled
 * mouth (the Human Reference Atlas, a character head) are compared point
 * for point without a person picking them.
 *
 * Each part is cut by a few parasagittal planes through a slab as thick as
 * an MRI slice and the cut points are pooled. On that slice:
 *
 * - upperIncisor: the incisal edge of the upper central incisors (the
 *   lowest point of the front of the upper teeth);
 * - lowerIncisor: the incisal edge of the lower central incisors;
 * - palateFront: the most anterior point of the hard palate (alveolar);
 * - staphylion: the posterior nasal spine, the back of the hard palate;
 * - uvula: the point of the velum farthest from the staphylion;
 * - tongueTip and tongueDorsum: the most anterior and the highest points
 *   of the tongue.
 *
 * Parts are triangle meshes in millimetres with y up and z forward (the
 * head frame and glTF's); x is across the face.
 */

import { tractShape } from '../articulation/tract-shape.js';
import { normalizeHeadConfig } from '../head-config.js';
import { rigidFit, transformPoint } from './align.js';
import { anatomyMeshes } from './anatomy.js';
import { sliceMesh } from './slice.js';

/** Thickness (mm) of the slab, as of a clinical MRI slice. */
export const SLICE_THICKNESS = 5;
/** Planes cut through the slab. */
const PLANES = 5;
/** Depth (mm) behind the front of an arch that still counts as incisor. */
const INCISOR_DEPTH = 3;

export const MOUTH_LANDMARKS = Object.freeze([
  'upperIncisor',
  'lowerIncisor',
  'palateFront',
  'staphylion',
  'uvula',
  'tongueTip',
  'tongueDorsum',
]);

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const extreme = (points, score) =>
  points.reduce((best, point) => (score(point) > score(best) ? point : best));

/** Middle of a mesh across the face: the midsagittal plane of an arch. */
export function midlineOf({ positions }) {
  let min = Infinity;
  let max = -Infinity;
  for (let at = 0; at < positions.length; at += 3) {
    min = Math.min(min, positions[at]);
    max = Math.max(max, positions[at]);
  }
  return (min + max) / 2;
}

/**
 * Points where a mesh crosses a parasagittal slab.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {number} midline x of the slab's middle.
 * @param {{thickness?: number, planes?: number}} [options]
 * @returns {number[][]}
 */
export function slabPoints(mesh, midline, options = {}) {
  const { thickness = SLICE_THICKNESS, planes = PLANES } = options;
  const points = [];
  for (let plane = 0; plane < planes; plane++) {
    const offset =
      midline + thickness * (planes > 1 ? plane / (planes - 1) - 0.5 : 0);
    for (const segment of sliceMesh(mesh, { normal: [1, 0, 0], offset })) {
      points.push(...segment);
    }
  }
  return points;
}

/**
 * Incisal edge of an arch on the slice: of the points within
 * INCISOR_DEPTH of the front, the lowest (upper) or highest (lower).
 */
function incisalEdge(points, jaw) {
  const front = Math.max(...points.map((point) => point[2]));
  const near = points.filter((point) => point[2] > front - INCISOR_DEPTH);
  const sign = jaw === 'upper' ? -1 : 1;
  return extreme(near, (point) => sign * point[1]);
}

/**
 * MOUTH_LANDMARKS of a mouth on its midsagittal slab (mm).
 * @param {{upperTeeth: object, lowerTeeth: object, palate: object,
 *   velum: object, tongue: object}} parts meshes in mm.
 * @param {{thickness?: number, planes?: number, midline?: number}} [options]
 *   `midline` defaults to the middle of the upper teeth.
 * @returns {Record<string, number[]>}
 */
export function mouthLandmarks(parts, options = {}) {
  const midline = options.midline ?? midlineOf(parts.upperTeeth);
  const slab = (mesh) => {
    const points = slabPoints(mesh, midline, options);
    if (!points.length) {
      throw new Error('a part does not cross the midsagittal slab');
    }
    return points;
  };
  const palate = slab(parts.palate);
  const staphylion = extreme(palate, (point) => -point[2]);
  const tongue = slab(parts.tongue);
  return {
    upperIncisor: incisalEdge(slab(parts.upperTeeth), 'upper'),
    lowerIncisor: incisalEdge(slab(parts.lowerTeeth), 'lower'),
    palateFront: extreme(palate, (point) => point[2]),
    staphylion,
    uvula: extreme(slab(parts.velum), (point) => distance(point, staphylion)),
    tongueTip: extreme(tongue, (point) => point[2]),
    tongueDorsum: extreme(tongue, (point) => point[1]),
  };
}

/**
 * Clinical distances (mm) between mouth landmarks: incisor to posterior
 * nasal spine, hard palate length, velum chord (staphylion to uvula),
 * overjet and overbite (positive when the upper incisors overlap the
 * lower), and the tongue dorsum above the upper incisal edge.
 * @param {Record<string, number[]>} landmarks from mouthLandmarks()
 */
export function mouthMeasures(landmarks) {
  const {
    upperIncisor,
    lowerIncisor,
    palateFront,
    staphylion,
    uvula,
    tongueDorsum,
  } = landmarks;
  return {
    incisorToStaphylion: distance(upperIncisor, staphylion),
    palateLength: distance(palateFront, staphylion),
    velumChord: distance(staphylion, uvula),
    overjet: upperIncisor[2] - lowerIncisor[2],
    overbite: lowerIncisor[1] - upperIncisor[1],
    dorsumHeight: tongueDorsum[1] - upperIncisor[1],
  };
}

/**
 * How far two mouths' landmarks lie apart after the best rigid fit of the
 * first onto the second: per landmark (mm) and their root mean square.
 * The landmarks lie on one slice, so they are compared in its plane (x
 * dropped): a fit in 3D could roll one mouth about the line of the others.
 * @param {Record<string, number[]>} model
 * @param {Record<string, number[]>} reference
 * @param {string[]} [names] landmarks to fit and compare.
 * @returns {{residuals: Record<string, number>, rms: number,
 *   transform: {rotation: number[][], translation: number[], scale: number}}}
 *   residuals of every landmark the two share, fitted on `names`.
 */
export function compareLandmarks(model, reference, names = MOUTH_LANDMARKS) {
  const flat = (point) => [0, point[1], point[2]];
  const fit = rigidFit(
    names.map((name) => flat(model[name])),
    names.map((name) => flat(reference[name]))
  );
  const shared = Object.keys(reference).filter((name) => model[name]);
  const residuals = Object.fromEntries(
    shared.map((name) => [
      name,
      distance(transformPoint(flat(model[name]), fit), flat(reference[name])),
    ])
  );
  return { residuals, rms: fit.rms, transform: fit };
}

const toMillimetres = ({ positions, indices }) => ({
  positions: Float32Array.from(positions, (value) => value * 10),
  indices,
});

/**
 * The procedural articulators of a head as mouthLandmarks() parts (mm).
 * @param {object} head head configuration
 * @param {{lod?: number, state?: object, shape?: object, gap?: number}}
 *   [options] as for anatomyMeshes(); `gap` (mm) holds the incisal edges
 *   that far apart vertically, negative for an overbite, to pose the jaw
 *   like a reference's.
 */
export function modelMouthParts(head, options = {}) {
  const { gap, ...rest } = options;
  if (gap !== undefined) {
    const shape =
      rest.shape ?? tractShape(rest.state ?? {}, normalizeHeadConfig(head));
    rest.shape = { ...shape, teeth: { ...shape.teeth, gap: gap / 10 } };
  }
  return Object.fromEntries(
    anatomyMeshes(head, rest).map((mesh) => [mesh.name, toMillimetres(mesh)])
  );
}

/**
 * One mesh of several (a tongue modelled as dorsum, underside and root).
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}[]} meshes
 */
export function mergeMeshes(meshes) {
  const positions = new Float32Array(
    meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0)
  );
  const indices = new Uint32Array(
    meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0)
  );
  let vertex = 0;
  let index = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, vertex * 3);
    for (let at = 0; at < mesh.indices.length; at++) {
      indices[index + at] = mesh.indices[at] + vertex;
    }
    vertex += mesh.positions.length / 3;
    index += mesh.indices.length;
  }
  return { positions, indices };
}
