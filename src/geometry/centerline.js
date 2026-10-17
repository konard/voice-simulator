/**
 * Placement of the vocal and nasal tracts inside the head.
 *
 * Coordinates are centimetres in a head frame: origin between the ear
 * canals, +y up, +z forward (out of the face) and +x to the side. The
 * vocal tract runs from the glottis up the pharynx, turns forward through
 * a circular bend behind the tongue and continues horizontally to the
 * lips; its arc length always equals the head's vocal tract length so the
 * acoustic model and the 3D model describe the same tube.
 */

import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';

/** Radius of the pharynx-to-mouth bend (cm). */
const BEND_RADIUS = 1.6;
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
      mouthY + 1.6 * config.headHeight,
      lipsZ + 0.9 * config.noseLength,
    ],
  };
}

/**
 * Point and unit tangent `distance` cm along a tract layout (see
 * tractCenterline().layout).
 * @param {number} distance
 * @param {{pharynx: number, bend: number, origin: number[]}} layout
 */
export function arcPoint(distance, layout) {
  const { pharynx, bend, origin } = layout;
  if (distance <= pharynx) {
    return {
      point: [0, origin[1] + distance, origin[2]],
      tangent: [0, 1, 0],
    };
  }
  if (distance <= pharynx + bend) {
    const angle = (distance - pharynx) / BEND_RADIUS;
    return {
      point: [
        0,
        origin[1] + pharynx + BEND_RADIUS * Math.sin(angle),
        origin[2] + BEND_RADIUS * (1 - Math.cos(angle)),
      ],
      tangent: [0, Math.cos(angle), Math.sin(angle)],
    };
  }
  const along = distance - pharynx - bend;
  return {
    point: [
      0,
      origin[1] + pharynx + BEND_RADIUS,
      origin[2] + BEND_RADIUS + along,
    ],
    tangent: [0, 0, 1],
  };
}

function tractLayout(length, pharynxRatio, lips) {
  const bend = (Math.PI / 2) * BEND_RADIUS;
  const pharynx = Math.max(1, length * pharynxRatio - bend / 2);
  const oral = Math.max(1, length - pharynx - bend);
  const origin = [
    0,
    lips[1] - pharynx - BEND_RADIUS,
    lips[2] - oral - BEND_RADIUS,
  ];
  return { pharynx, bend, oral, origin, length: pharynx + bend + oral };
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

function bezier(start, control, end) {
  return (t) => {
    const u = 1 - t;
    const point = [0, 1, 2].map(
      (axis) =>
        u * u * start[axis] + 2 * u * t * control[axis] + t * t * end[axis]
    );
    const derivative = [0, 1, 2].map(
      (axis) =>
        2 * u * (control[axis] - start[axis]) +
        2 * t * (end[axis] - control[axis])
    );
    const norm = Math.hypot(...derivative) || 1;
    return { point, tangent: derivative.map((value) => value / norm) };
  };
}

function curveLength(at, steps = 48) {
  let length = 0;
  let previous = at(0).point;
  for (let step = 1; step <= steps; step++) {
    const point = at(step / steps).point;
    length += Math.hypot(...point.map((value, axis) => value - previous[axis]));
    previous = point;
  }
  return length;
}

/**
 * Centreline of the nasal tract: from the velopharyngeal port on the back
 * pharynx wall, arching over the palate to the nostrils. The arch height
 * is solved so the path is as long as the acoustic nose model.
 * @param {Record<string, number>} head
 * @param {{sections?: number, velumDistance: number, length: number, tractLength?: number}} options
 */
export function nasalCenterline(head, options) {
  const config = normalizeHeadConfig(head);
  const tract = tractCenterline(config, {
    length: options.tractLength,
    sections: 1,
  });
  const port = arcPoint(options.velumDistance, tract.layout).point;
  const start = [0, port[1] + 0.6, port[2] + 0.3];
  const end = headLandmarks(config).nostrils;
  const curve = (height) =>
    bezier(start, [0, end[1] + height, start[2] + 1.5], end);
  let low = 0;
  let high = 12;
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
