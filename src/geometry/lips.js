/**
 * Upper and lower lip for the 3D head: two closed lofts across the mouth,
 * from one corner (commissure) to the other. Their free edges outline an
 * opening with the area of the last tract section, so the mouth seen in
 * 3D opens as far as the one the solvers hear. The upper lip has a
 * Cupid's bow and a central tubercle, the lower lip is fuller, both taper
 * into the corners and follow the curve of the face back from the
 * midline. Rounding narrows the mouth, pushes the lips forward and makes
 * the opening rounder.
 *
 * Proportions are adult averages in cm: mouth width about 5, vermilion
 * height about 0.8 (upper) and 1 (lower), lip depth front to back about
 * 1.2 (Farkas 1994, anthropometry of the head and face).
 */

import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import { headLandmarks, upperNormal } from './centerline.js';
import { mergeMeshes, loftMesh } from './loft.js';
import { TRACT_TEMPLATE } from './tract-template.js';

/** Columns across the mouth and points around each lip section per LOD. */
export const LIP_LODS = Object.freeze([
  Object.freeze({ columns: 9, ring: 8 }),
  Object.freeze({ columns: 13, ring: 10 }),
  Object.freeze({ columns: 21, ring: 14 }),
  Object.freeze({ columns: 33, ring: 20 }),
]);

/** Half the mouth width, corner to corner (cm, scaled by mouthWidth). */
const MOUTH_HALF_WIDTH = 2.4;
/** The lips stay closed at least this far inside each corner (cm). */
const CORNER_SEAL = 0.3;
/** Vermilion heights of the upper and lower lip (cm, x lipThickness). */
const UPPER_HEIGHT = 0.85;
const LOWER_HEIGHT = 1.05;
/**
 * Forward bulge and depth behind the free edge (cm, x lipThickness). The
 * lower lip lies on the labial face of the lower incisors, which slopes
 * forward, so it is shallower behind its edge.
 */
const BULGE = 0.45;
const UPPER_DEPTH = 0.55;
const LOWER_DEPTH = 0.4;
/** How far the corners lie behind the midline of the lips (cm). */
const CORNER_SETBACK = 0.9;
/** Forward push of fully rounded lips (cm) and their narrowing. */
const PROTRUSION = 0.6;
const NARROWING = 0.4;
/** Width-to-height ratio of a fully rounded opening. */
const ROUND_ASPECT = 1.3;
/**
 * Widest half-width of an unrounded opening (cm, x mouthWidth): spread
 * and open vowels open the lips about 4 cm wide (Fromkin 1964).
 */
const OPEN_HALF_WIDTH = 2;
/** Share of the opening height taken by the lower lip beyond half. */
const LOWER_SHARE = 0.4;

function gaussian(x, centre, width) {
  return Math.exp(-(((x - centre) / width) ** 2));
}

/**
 * Semi-axes (cm) of the lip opening for its area: a slit as wide as the
 * open mouth until it is as tall as it is round, rounder and narrower with
 * lip rounding. The tract section behind it (sectionAxes) has the same
 * area.
 * @param {number} area cm².
 * @param {number} rounding 0..1
 * @param {Record<string, number>} config
 */
export function lipOpening(area, rounding, config) {
  const safe = Math.max(area, 1e-4);
  const halfWidth = OPEN_HALF_WIDTH * config.mouthWidth;
  const slit = Math.max(1, (Math.PI * halfWidth * halfWidth) / safe);
  const aspect = slit * (1 - rounding) + ROUND_ASPECT * rounding;
  const major = Math.sqrt((safe * aspect) / Math.PI);
  return [major, safe / (Math.PI * major)];
}

/**
 * Frame of the mouth: the end of the tract (centre of the opening), its
 * forward tangent and the upward normal of the opening.
 */
function mouthFrame(config) {
  const { lips } = headLandmarks(config);
  const angle = (TRACT_TEMPLATE.bendAngles.at(-1) * Math.PI) / 180;
  const tangent = [0, Math.cos(angle), Math.sin(angle)];
  return { centre: lips, tangent, normal: upperNormal(tangent) };
}

/**
 * Point of one lip section: `forward` along the tract tangent and `up`
 * along the opening normal (negative for the lower lip) from the free
 * edge at lateral `x`.
 */
function lipPoint(frame, x, edge, forward, up) {
  const { centre, tangent, normal } = frame;
  return [0, 1, 2].map(
    (axis) =>
      centre[axis] +
      (axis === 0 ? x : 0) +
      tangent[axis] * forward +
      normal[axis] * (edge + up)
  );
}

/**
 * One lip as a closed loft: columns from the right corner to the left,
 * each a closed section that starts at the free edge, bulges forward,
 * rises to the vermilion border and returns behind the edge.
 */
function lipMesh(frame, lip, lod) {
  const { columns, ring } = LIP_LODS[lod];
  const { width, opening, sign, height, bulge, depth, shape } = lip;
  const [major, minor] = opening;
  return loftMesh(columns, ring, (column, step) => {
    const s = (2 * column) / (columns - 1) - 1;
    const x = s * width;
    // Thickness tapers into the corner but keeps a rounded rim there.
    const taper = Math.max(0.08, (1 - s * s) ** 0.4);
    const inside = Math.max(0, 1 - (x / major) ** 2);
    // The jaw carries the lower lip: it takes more of the opening.
    const edge = minor * Math.sqrt(inside) * (sign - LOWER_SHARE);
    const setback = -CORNER_SETBACK * s * s + lip.protrusion * taper;
    // The lower lip is the upper one mirrored, walked the other way round
    // so both keep their faces outward.
    const angle = (sign * 2 * Math.PI * step) / ring - Math.PI / 2;
    const cos = Math.cos(angle);
    const forward =
      cos * (cos > 0 ? bulge * shape.bulge(x) : depth) * taper + setback;
    const up =
      (sign * height * shape.height(x) * taper * (1 + Math.sin(angle))) / 2;
    return lipPoint(frame, x, edge, forward, up);
  });
}

/**
 * Upper and lower lip as one mesh with a constant vertex count per LOD.
 * @param {Record<string, number>} head
 * @param {{area?: number, rounding?: number, lod?: number}} [options]
 *   `area` is the lip opening (cm², the last tract section).
 * @returns {{positions: Float32Array, indices: Uint32Array}}
 */
export function lipsMesh(head = DEFAULT_HEAD, options = {}) {
  const config = normalizeHeadConfig(head);
  const lod = Math.min(LIP_LODS.length - 1, Math.max(0, options.lod ?? 1));
  const rounding = Math.min(1, Math.max(0, options.rounding ?? 0));
  const opening = lipOpening(options.area ?? 1, rounding, config);
  const width = Math.max(
    opening[0] + CORNER_SEAL,
    MOUTH_HALF_WIDTH * config.mouthWidth * (1 - NARROWING * rounding)
  );
  const thickness = config.lipThickness;
  const frame = mouthFrame(config);
  const common = {
    width,
    opening,
    protrusion: PROTRUSION * rounding,
    bulge: BULGE * thickness,
  };
  const upper = lipMesh(
    frame,
    {
      ...common,
      sign: 1,
      height: UPPER_HEIGHT * thickness,
      depth: UPPER_DEPTH * thickness,
      shape: {
        // Cupid's bow: peaks either side of the philtrum, a dip between.
        height: (x) =>
          1 +
          0.15 * (gaussian(x, 0.55, 0.35) + gaussian(x, -0.55, 0.35)) -
          0.12 * gaussian(x, 0, 0.25),
        // The central tubercle pushes the middle of the upper lip forward.
        bulge: (x) => 1 + 0.25 * gaussian(x, 0, 0.6),
      },
    },
    lod
  );
  const lower = lipMesh(
    frame,
    {
      ...common,
      sign: -1,
      height: LOWER_HEIGHT * thickness,
      depth: LOWER_DEPTH * thickness,
      shape: { height: () => 1, bulge: (x) => 1 + 0.15 * gaussian(x, 0, 1) },
    },
    lod
  );
  return mergeMeshes([upper, lower]);
}
