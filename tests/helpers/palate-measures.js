/**
 * Midline measures (mm) of the model's hard palate and velum, defined like
 * the anatomical norms in tests/fixtures/anatomy/palate.json.
 */

import {
  ANATOMY_LODS,
  dentalLandmarks,
  palateMesh,
  velumMesh,
} from '../../src/geometry/anatomy.js';

const LOD = ANATOMY_LODS.length - 1;

/** Oral, nasal and side points (mm) of each cross-section of a wall slab. */
function slabRows(mesh, sections) {
  const { across } = ANATOMY_LODS[LOD];
  const columns = 2 * across + 1;
  const point = (row, step) => {
    const start = (row * 2 * columns + step) * 3;
    return Array.from(mesh.positions.subarray(start, start + 3), (v) => v * 10);
  };
  return Array.from({ length: sections }, (_, row) => ({
    oral: point(row, across),
    nasal: point(row, 2 * columns - 1 - across),
  }));
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const midpoint = (a, b) => a.map((value, axis) => (value + b[axis]) / 2);
const pathLength = (points) =>
  points.reduce(
    (sum, point, index) =>
      index === 0 ? 0 : sum + distance(point, points[index - 1]),
    0
  );

/**
 * Point of the oral palate line at depth z (front to back, z falls), NaN
 * where the palate does not reach.
 */
function palateAt(palate, z) {
  const after = palate.findIndex((row) => row.oral[2] <= z);
  if (after < 1) {
    return [NaN, NaN, NaN];
  }
  const [a, b] = [palate[after - 1].oral, palate[after].oral];
  const t = (a[2] - z) / (a[2] - b[2]);
  return a.map((value, axis) => value + t * (b[axis] - value));
}

/** Middle of the occlusal points of an upper tooth pair (landmarks are in mm). */
function upperPair(head, type) {
  const [left, right] = dentalLandmarks(head).filter(
    (tooth) => tooth.jaw === 'upper' && tooth.type === type
  );
  return midpoint(left.occlusal, right.occlusal);
}

/**
 * Orale-staphylion length (incisors' lingual alveolar margin to the
 * posterior nasal spine, straight), the spine's distance behind the upper
 * second molars, the vault height above the occlusal points of the first
 * and second molars, and the velum's length along its middle line (hard
 * palate to the tip of the uvula) and greatest thickness.
 */
export function palateMeasures(head) {
  const { tongue, velum: velumRows } = ANATOMY_LODS[LOD];
  const palate = slabRows(palateMesh(head, { lod: LOD }), tongue);
  const velum = slabRows(velumMesh(head, { lod: LOD }), velumRows);
  const incisor = dentalLandmarks(head).find(
    (tooth) => tooth.jaw === 'upper' && tooth.type === 0
  );
  const orale = palateAt(palate, incisor.occlusal[2] - incisor.thickness / 2);
  const staphylion = palate.at(-1).oral;
  const vaultHeight = (type) => {
    const molars = upperPair(head, type);
    return palateAt(palate, molars[2])[1] - molars[1];
  };
  return {
    oraleStaphylion: distance(orale, staphylion),
    nasalSpineBehindMolars: upperPair(head, 6)[2] - staphylion[2],
    vaultHeightFirstMolars: vaultHeight(5),
    vaultHeightSecondMolars: vaultHeight(6),
    velumLength: pathLength(velum.map((row) => midpoint(row.oral, row.nasal))),
    velumThickness: Math.max(
      ...velum.map((row) => distance(row.oral, row.nasal))
    ),
  };
}
