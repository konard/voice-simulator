/**
 * Placement of the vocal and nasal tracts inside the head.
 *
 * Coordinates are centimetres in a head frame: origin between the ear
 * canals, +y up, +z forward (out of the face) and +x to the side. The
 * vocal tract follows the midsagittal shape of MRI vocal tracts
 * (tract-template.js): up the pharynx, bending forward under the palate
 * and down through the front teeth to the lips. Its arc length always
 * equals the head's vocal tract length so the acoustic model and the 3D
 * model describe the same tube.
 */

import {
  INCISOR_THICKNESS,
  REST_GAP,
  incisorDepth,
} from '../articulation/teeth.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import { TRACT_TEMPLATE } from './tract-template.js';

/** Lip midpoint below the ear canal line (cm) for an average head. */
const MOUTH_DROP = 6.2;
/** Face surface in front of the ear canals at mouth height (cm). */
const FACE_DEPTH = 9.6;

/**
 * Key landmarks for a head.
 * @param {Record<string, number>} head
 */
export function headLandmarks(head = DEFAULT_HEAD) {
  const config = normalizeHeadConfig(head);
  const mouthY = -MOUTH_DROP * config.headHeight;
  const lipsZ = FACE_DEPTH * Math.sqrt(config.headWidth * config.headHeight);
  return {
    lips: [0, mouthY, lipsZ],
    jawPivot: [0, -1.2 * config.headHeight, 0.6],
    noseTip: [
      0,
      mouthY + 2.6 * config.headHeight,
      lipsZ + 1.6 * config.noseLength,
    ],
    nostrils: [
      0,
      mouthY + 2 * config.headHeight,
      lipsZ + 0.8 * config.noseLength,
    ],
  };
}

/** Integration steps of the centreline table. */
const LAYOUT_STEPS = 256;

/**
 * Position in the MRI template (0 = glottis, 0.5 = middle of the bend,
 * 1 = lips) of a fraction of the tract length: the pharynx, glottis to
 * bend, is `pharynxRatio` of the length.
 * @param {number} fraction
 * @param {number} pharynxRatio
 */
export function templatePosition(fraction, pharynxRatio) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return clamped <= pharynxRatio
    ? (0.5 * clamped) / pharynxRatio
    : 0.5 + (0.5 * (clamped - pharynxRatio)) / (1 - pharynxRatio);
}

/**
 * Linear interpolation of a template profile at a template position.
 * @param {readonly number[]} values
 * @param {number} position
 */
export function templateValue(values, position) {
  const scaled = Math.min(1, Math.max(0, position)) * (values.length - 1);
  const index = Math.min(values.length - 2, Math.floor(scaled));
  const t = scaled - index;
  return values[index] * (1 - t) + values[index + 1] * t;
}

function tangentAt(fraction, pharynxRatio) {
  const angle =
    (templateValue(
      TRACT_TEMPLATE.bendAngles,
      templatePosition(fraction, pharynxRatio)
    ) *
      Math.PI) /
    180;
  return [0, Math.cos(angle), Math.sin(angle)];
}

/**
 * Point and unit tangent `distance` cm along a tract layout (see
 * tractCenterline().layout); beyond the ends the path continues straight.
 * @param {number} distance
 * @param {{length: number, step: number, points: Float64Array, pharynxRatio: number}} layout
 */
export function arcPoint(distance, layout) {
  const { length, step, points, pharynxRatio } = layout;
  const tangent = tangentAt(distance / length, pharynxRatio);
  const clamped = Math.min(length, Math.max(0, distance));
  const steps = points.length / 3 - 1;
  const index = Math.min(steps - 1, Math.floor(clamped / step));
  const t = clamped / step - index;
  const overshoot = distance - clamped;
  return {
    point: [0, 1, 2].map(
      (axis) =>
        points[index * 3 + axis] * (1 - t) +
        points[index * 3 + 3 + axis] * t +
        overshoot * tangent[axis]
    ),
    tangent,
  };
}

/**
 * The tract centreline as a table: the MRI template's bend angle is
 * integrated along the length and the path is placed so it ends at the
 * lips.
 */
function tractLayout(length, pharynxRatio, lips) {
  const step = length / LAYOUT_STEPS;
  const points = new Float64Array((LAYOUT_STEPS + 1) * 3);
  for (let index = 1; index <= LAYOUT_STEPS; index++) {
    const tangent = tangentAt((index - 0.5) / LAYOUT_STEPS, pharynxRatio);
    for (let axis = 0; axis < 3; axis++) {
      points[index * 3 + axis] =
        points[index * 3 - 3 + axis] + step * tangent[axis];
    }
  }
  const end = points.slice(-3);
  for (let index = 0; index <= LAYOUT_STEPS; index++) {
    for (let axis = 0; axis < 3; axis++) {
      points[index * 3 + axis] += lips[axis] - end[axis];
    }
  }
  return {
    length,
    step,
    points,
    pharynxRatio,
    origin: Array.from(points.subarray(0, 3)),
  };
}

/**
 * Sample a path at section centres.
 * @param {(distance: number) => {point: number[], tangent: number[]}} at
 * @param {number} length
 * @param {number} count
 */
function samplePath(at, length, count) {
  const points = new Float64Array(count * 3);
  const tangents = new Float64Array(count * 3);
  for (let index = 0; index < count; index++) {
    const { point, tangent } = at(((index + 0.5) / count) * length);
    points.set(point, index * 3);
    tangents.set(tangent, index * 3);
  }
  return { points, tangents, length, count, sectionLength: length / count };
}

/**
 * Centreline of the vocal tract for a tube of `length` cm.
 * @param {Record<string, number>} head
 * @param {{sections?: number, length?: number}} [options]
 */
export function tractCenterline(head = DEFAULT_HEAD, options = {}) {
  const config = normalizeHeadConfig(head);
  const { lips } = headLandmarks(config);
  const layout = tractLayout(
    options.length ?? config.vocalTractLength,
    config.pharynxRatio,
    lips
  );
  return {
    ...samplePath(
      (distance) => arcPoint(distance, layout),
      layout.length,
      options.sections ?? 44
    ),
    layout,
  };
}

/**
 * Upper incisors on a tract layout: the incisal edge (cm, head frame
 * height) sits REST_GAP/2 above the centreline in the middle of the
 * incisor row, so the rest gap is centred on the airway; the labial face
 * (`front`, z) is where the centreline is `incisorDepth` behind the lips
 * and `plane` is the z of the middle of the row. `centre`, `start` and
 * `end` are distances along the tract. The 3D meshes and the voxel solver
 * share it.
 * @param {Record<string, number>} head
 * @param {{length: number, step: number, points: Float64Array, pharynxRatio: number}} layout
 */
export function incisorFrame(head, layout) {
  const config = normalizeHeadConfig(head);
  const end = layout.length - incisorDepth(config);
  const centre = end - INCISOR_THICKNESS / 2;
  const middle = arcPoint(centre, layout).point;
  return {
    edge: middle[1] + REST_GAP / 2,
    front: arcPoint(end, layout).point[2],
    plane: middle[2],
    centre,
    start: end - INCISOR_THICKNESS,
    end,
  };
}

/** Unit vector from the tract centreline towards the palate / back wall. */
export function upperNormal(tangent) {
  return [0, tangent[2], -tangent[1]];
}

/** Uniform Catmull-Rom spline through points (ends repeated). */
function catmullRom(points) {
  const segments = points.length - 1;
  const at = (index) => points[Math.min(points.length - 1, Math.max(0, index))];
  return (t) => {
    const scaled = Math.min(segments - 1e-9, Math.max(0, t * segments));
    const index = Math.floor(scaled);
    const u = scaled - index;
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((k) => at(index + k));
    const point = [0, 1, 2].map(
      (axis) =>
        0.5 *
        (2 * p1[axis] +
          (p2[axis] - p0[axis]) * u +
          (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * u * u +
          (3 * p1[axis] - p0[axis] - 3 * p2[axis] + p3[axis]) * u * u * u)
    );
    const derivative = [0, 1, 2].map(
      (axis) =>
        0.5 *
        (p2[axis] -
          p0[axis] +
          2 * (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * u +
          3 * (3 * p1[axis] - p0[axis] - 3 * p2[axis] + p3[axis]) * u * u)
    );
    const norm = Math.hypot(...derivative) || 1;
    return { point, tangent: derivative.map((value) => value / norm) };
  };
}

function curveLength(at, steps = 96) {
  let length = 0;
  let previous = at(0).point;
  for (let step = 1; step <= steps; step++) {
    const point = at(step / steps).point;
    length += Math.hypot(...point.map((value, axis) => value - previous[axis]));
    previous = point;
  }
  return length;
}

/** Nasal path start inside the tract wall above the port (cm). */
const PORT_DEPTH = 0.6;
/** Nasopharynx behind the raised velum, from the tract centreline (cm). */
const NASOPHARYNX = 1.5;
/** How far along the tract the nasopharynx lies past the port (cm). */
const NASOPHARYNX_RISE = 0.8;
/**
 * Floor of the nasal passage above the tract centreline under the
 * palate: the airway's upper half (about 0.5 cm), the hard palate (about
 * 0.6 cm) and half the passage (cm).
 */
const NASAL_FLOOR = 1.9;
/**
 * Lowest the passage may run above the tract centreline: the airway's
 * upper half and the hard palate (cm).
 */
const NASAL_FLOOR_MIN = 1.1;

/**
 * Centreline of the nasal tract: from the velopharyngeal port on the
 * upper (back) wall of the tract up into the nasopharynx behind the
 * velum, forward above the hard palate and down to the nostrils. How far
 * the passage arches above the palate is solved so the path is as long
 * as the acoustic nose model.
 * @param {Record<string, number>} head
 * @param {{sections?: number, velumDistance: number, length: number, tractLength?: number}} options
 */
export function nasalCenterline(head, options) {
  const config = normalizeHeadConfig(head);
  const { layout } = tractCenterline(config, {
    length: options.tractLength,
    sections: 1,
  });
  const above = (distance, height) => {
    const { point, tangent } = arcPoint(distance, layout);
    const normal = upperNormal(tangent);
    return point.map((value, axis) => value + normal[axis] * height);
  };
  const port = options.velumDistance;
  const front = layout.length - 2.2;
  const back = port + 0.35 * (front - port);
  const end = headLandmarks(config).nostrils;
  const curve = (height) =>
    catmullRom([
      above(port, PORT_DEPTH),
      above(port + NASOPHARYNX_RISE, NASOPHARYNX),
      ...[0, 1, 2, 3].map((step) =>
        above(back + (step / 3) * (front - back), NASAL_FLOOR + height)
      ),
      end,
    ]);
  let low = NASAL_FLOOR_MIN - NASAL_FLOOR;
  let high = 8;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    if (curveLength(curve(middle)) < options.length) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const at = curve(low);
  const length = curveLength(at);
  return samplePath(
    (distance) => at(distance / length),
    length,
    options.sections ?? 28
  );
}
