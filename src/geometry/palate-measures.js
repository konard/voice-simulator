/**
 * Measurements of the procedural hard palate and velum (millimetres), with
 * the definitions of the anatomical studies they are checked against
 * (tests/fixtures/anatomy/palate.json):
 *
 * - orale-staphylion: midline length of the hard palate, from behind the
 *   upper central incisors to the posterior nasal spine (Tomaszewska et al.
 *   2014, on skulls);
 * - nasal spine behind the second molars, along the face;
 * - vault height: the oral palate surface above the occlusal point of the
 *   first and second molars;
 * - velum length: curvilinear, along the middle of the velum from the hard
 *   palate to the tip of the uvula, and velum thickness, the greatest
 *   across it (Perry et al. 2016, on MRI).
 */

import {
  ANATOMY_LODS,
  dentalLandmarks,
  palateMesh,
  velumMesh,
} from './anatomy.js';

const FIRST_MOLAR = 5;
const SECOND_MOLAR = 6;

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const midpoint = (a, b) => a.map((value, axis) => (value + b[axis]) / 2);

/**
 * Midline points of each cross-section of a wall slab: the oral and nasal
 * faces, from front to back, in mm.
 */
function midlineRows(mesh, sections, across) {
  const columns = 2 * across + 1;
  const ring = 2 * columns;
  const at = (row, step) => {
    const offset = (row * ring + step) * 3;
    return Array.from(
      mesh.positions.subarray(offset, offset + 3),
      (value) => value * 10
    );
  };
  return Array.from({ length: sections }, (_, row) => ({
    oral: at(row, across),
    nasal: at(row, 2 * columns - 1 - across),
  }));
}

function curveLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += distance(points[index], points[index - 1]);
  }
  return length;
}

/** Midline occlusal point of a pair of upper teeth (mm). */
function upperPair(landmarks, type) {
  const [left, right] = landmarks.filter(
    (tooth) => tooth.jaw === 'upper' && tooth.type === type
  );
  return midpoint(left.occlusal, right.occlusal);
}

/** Oral palate surface at a depth z (mm), between the nearest rows. */
function palateAt(rows, z) {
  const after = rows.findIndex((row) => row.oral[2] <= z);
  if (after <= 0) {
    return rows[Math.max(after, 0)].oral;
  }
  const [front, back] = [rows[after - 1].oral, rows[after].oral];
  const t = (front[2] - z) / (front[2] - back[2]);
  return front.map((value, axis) => value + t * (back[axis] - value));
}

/**
 * Hard palate and velum measures of a head (mm) at a level of detail.
 * @param {object} head head configuration
 * @param {{lod?: number}} [options]
 */
export function palateMeasures(head, { lod = ANATOMY_LODS.length - 1 } = {}) {
  const { across, tongue, velum: velumSections } = ANATOMY_LODS[lod];
  const palate = midlineRows(palateMesh(head, { lod }), tongue, across);
  const velum = midlineRows(velumMesh(head, { lod }), velumSections, across);
  const landmarks = dentalLandmarks(head);
  const incisor = landmarks.find(
    (tooth) => tooth.jaw === 'upper' && tooth.type === 0
  );
  const orale = palateAt(palate, incisor.occlusal[2] - incisor.thickness / 2);
  const staphylion = palate.at(-1).oral;
  const vaultHeight = (type) => {
    const molars = upperPair(landmarks, type);
    return palateAt(palate, molars[2])[1] - molars[1];
  };
  return {
    oraleStaphylion: distance(orale, staphylion),
    nasalSpineBehindMolars:
      upperPair(landmarks, SECOND_MOLAR)[2] - staphylion[2],
    vaultHeightFirstMolars: vaultHeight(FIRST_MOLAR),
    vaultHeightSecondMolars: vaultHeight(SECOND_MOLAR),
    velumLength: curveLength(velum.map((row) => midpoint(row.oral, row.nasal))),
    velumThickness: Math.max(
      ...velum.map((row) => distance(row.oral, row.nasal))
    ),
  };
}
