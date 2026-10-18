/**
 * Orthodontic measurements of a dentition, so the procedural teeth can be
 * checked against segmented anatomy (Z-Anatomy, BodyParts3D and the
 * Open-Full-Jaw CBCT scans) in a way that does not depend on the frame
 * each source was modelled in.
 *
 * Every tooth is reduced to an occlusal point (the middle of its incisal
 * edge or occlusal table), a mesiodistal crown width along the arch and a
 * labio-lingual thickness across it. From those come the arch measures
 * clinicians use: intercanine and intermolar widths, arch depth from the
 * incisors to the first molars, arch length (summed crown widths),
 * overjet and overbite.
 */

import { principalEigenvector } from './align.js';

/** Permanent teeth from the midline back; the third molars are left out. */
export const TOOTH_TYPES = Object.freeze([
  'central incisor',
  'lateral incisor',
  'canine',
  'first premolar',
  'second premolar',
  'first molar',
  'second molar',
]);

const CANINE = 2;
const FIRST_MOLAR = 5;
/** Vertices this close (mm) to the occlusal extreme make the occlusal point. */
const OCCLUSAL_BAND = 1.5;
/** Crown: vertices this far (mm) from the tip along the long axis, roots left out. */
const CROWN_BAND = 9;

const sub = (a, b) => a.map((value, axis) => value - b[axis]);
const add = (a, b) => a.map((value, axis) => value + b[axis]);
const scale = (a, factor) => a.map((value) => value * factor);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a) => scale(a, 1 / Math.hypot(...a));
const mean = (points) =>
  scale(
    points.reduce((sum, point) => add(sum, point), [0, 0, 0]),
    1 / points.length
  );

function covarianceOf(points) {
  const centre = mean(points);
  const covariance = [0, 1, 2].map(() => [0, 0, 0]);
  for (const point of points) {
    const d = sub(point, centre);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        covariance[i][j] += d[i] * d[j];
      }
    }
  }
  return covariance;
}

/** Direction of largest variance: the long axis of a tooth. */
function principalAxis(points) {
  return normalize(principalEigenvector(covarianceOf(points)));
}

/** Unit normal of the plane that best fits the points (least variance). */
function planeNormal(points) {
  const covariance = covarianceOf(points);
  const trace = covariance[0][0] + covariance[1][1] + covariance[2][2];
  // The largest eigenvector of trace*I - C is the smallest one of C.
  return normalize(
    principalEigenvector(
      covariance.map((row, i) =>
        row.map((value, j) => (i === j ? trace : 0) - value)
      )
    )
  );
}

function vertices(positions) {
  const points = [];
  for (let index = 0; index < positions.length; index += 3) {
    points.push([positions[index], positions[index + 1], positions[index + 2]]);
  }
  return points;
}

const key = (jaw, side, type) => `${jaw} ${side} ${type}`;

const pick = ({ jaw, side, type, occlusal }) => ({ jaw, side, type, occlusal });

/**
 * A direction that points from the lower arch to the upper: between the
 * arches when both are there, otherwise from the roots of the one arch to
 * its crowns (or back, for an upper arch). A crown is bulkier than its
 * root, so a tooth's centroid lies nearer its crown end.
 */
function upwards(meshes, centroids) {
  const centre = (jaw) =>
    mean(centroids.filter((_, index) => meshes[index].jaw === jaw));
  const jaws = new Set(meshes.map((tooth) => tooth.jaw));
  if (jaws.size === 2) {
    return sub(centre('upper'), centre('lower'));
  }
  const normal = planeNormal(centroids);
  let lean = 0;
  meshes.forEach((tooth, index) => {
    const heights = tooth.points.map((point) => dot(point, normal));
    const middle = dot(centroids[index], normal);
    lean += 2 * middle - Math.max(...heights) - Math.min(...heights);
  });
  // lean > 0: the crowns are towards +normal.
  return scale(normal, jaws.has('upper') === lean > 0 ? -1 : 1);
}

/**
 * Occlusal points, crown widths and thicknesses of segmented teeth.
 * @param {{jaw: 'upper'|'lower', side: 'l'|'r', type: number,
 *   positions: ArrayLike<number>}[]} teeth One mesh per tooth (mm), `type`
 *   indexes TOOTH_TYPES; one arch alone is enough.
 * @returns {{jaw: 'upper'|'lower', side: 'l'|'r', type: number,
 *   occlusal: number[], width: number, thickness: number}[]}
 */
export function toothLandmarks(teeth) {
  const meshes = teeth.map((tooth) => ({
    ...tooth,
    points: vertices(tooth.positions),
  }));
  const centroids = meshes.map((tooth) => mean(tooth.points));
  let up = planeNormal(centroids);
  if (dot(up, upwards(meshes, centroids)) < 0) {
    up = scale(up, -1);
  }
  const located = meshes.map((tooth) => {
    const toward = tooth.jaw === 'upper' ? scale(up, -1) : up;
    const heights = tooth.points.map((point) => dot(point, toward));
    const top = Math.max(...heights);
    const band = tooth.points.filter(
      (_, index) => heights[index] > top - OCCLUSAL_BAND
    );
    // Crowns are measured in the tooth's own frame, so proclined incisors
    // and tipped molars are not made wider by their tilt.
    let axis = principalAxis(tooth.points);
    if (dot(axis, toward) < 0) {
      axis = scale(axis, -1);
    }
    const lengths = tooth.points.map((point) => dot(point, axis));
    const tip = Math.max(...lengths);
    const crown = tooth.points.filter(
      (_, index) => lengths[index] > tip - CROWN_BAND
    );
    return { ...tooth, occlusal: mean(band), axis, crown };
  });
  const byKey = new Map(
    located.map((tooth) => [key(tooth.jaw, tooth.side, tooth.type), tooth])
  );
  return located.map((tooth) => {
    const along = archTangent(tooth, byKey, up);
    if (!along) {
      return { ...pick(tooth), width: null, thickness: null };
    }
    const tangent = normalize(
      sub(along, scale(tooth.axis, dot(along, tooth.axis)))
    );
    const across = cross(tooth.axis, tangent);
    const extent = (direction) => {
      const values = tooth.crown.map((point) => dot(point, direction));
      return Math.max(...values) - Math.min(...values);
    };
    return {
      ...pick(tooth),
      width: extent(tangent),
      thickness: extent(across),
    };
  });
}

/**
 * Direction of the arch at a tooth, in the plane, from its nearest present
 * neighbours (across the midline for the central incisors); null when the
 * tooth has no neighbour at all.
 */
function archTangent(tooth, byKey, up) {
  const other = tooth.side === 'l' ? 'r' : 'l';
  const along = [];
  for (let type = 6; type >= 0; type--) {
    along.push(byKey.get(key(tooth.jaw, other, type)));
  }
  for (let type = 0; type < 7; type++) {
    along.push(byKey.get(key(tooth.jaw, tooth.side, type)));
  }
  const at = 7 + tooth.type;
  const mesial = along.slice(0, at).findLast(Boolean) ?? tooth;
  const distal = along.slice(at + 1).find(Boolean) ?? tooth;
  const direction = sub(distal.occlusal, mesial.occlusal);
  const flat = sub(direction, scale(up, dot(direction, up)));
  return Math.hypot(...flat) > 0 ? normalize(flat) : null;
}

function averageBySides(landmarks, jaw, type, read) {
  const values = landmarks
    .filter((tooth) => tooth.jaw === jaw && tooth.type === type)
    .map(read)
    .filter((value) => value !== null);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

/**
 * Arch measures (mm) from tooth landmarks: per arch the mean crown widths
 * and thicknesses by tooth type, intercanine and intermolar widths, arch
 * depth and arch length; between the arches overjet and overbite. A
 * measure is null when a tooth it needs is missing.
 * @param {ReturnType<typeof toothLandmarks>} landmarks
 */
export function archMeasures(landmarks) {
  const find = (jaw, side, type) =>
    landmarks.find(
      (tooth) => tooth.jaw === jaw && tooth.side === side && tooth.type === type
    )?.occlusal;
  const upperCentre = mean(
    landmarks.filter((t) => t.jaw === 'upper').map((t) => t.occlusal)
  );
  const lowerCentre = mean(
    landmarks.filter((t) => t.jaw === 'lower').map((t) => t.occlusal)
  );
  let up = planeNormal(landmarks.map((tooth) => tooth.occlusal));
  if (dot(up, sub(upperCentre, lowerCentre)) < 0) {
    up = scale(up, -1);
  }
  const flat = (vector) => sub(vector, scale(up, dot(vector, up)));
  const pair = (jaw, type) => {
    const left = find(jaw, 'l', type);
    const right = find(jaw, 'r', type);
    return left && right ? { left, right, middle: mean([left, right]) } : null;
  };
  const incisors = {
    upper: pair('upper', 0),
    lower: pair('lower', 0),
  };
  // Forward along the midline, from the first molars to the incisors.
  const forwardOf = (jaw) => {
    const molars = pair(jaw, FIRST_MOLAR);
    return incisors[jaw] && molars
      ? normalize(flat(sub(incisors[jaw].middle, molars.middle)))
      : null;
  };
  const forward = forwardOf('upper') ?? forwardOf('lower');
  const arch = (jaw) => {
    const canines = pair(jaw, CANINE);
    const firstMolars = pair(jaw, FIRST_MOLAR);
    const widths = TOOTH_TYPES.map((_, type) =>
      averageBySides(landmarks, jaw, type, (tooth) => tooth.width)
    );
    const span = (both) =>
      both ? Math.hypot(...flat(sub(both.left, both.right))) : null;
    return {
      widths,
      thicknesses: TOOTH_TYPES.map((_, type) =>
        averageBySides(landmarks, jaw, type, (tooth) => tooth.thickness)
      ),
      intercanine: span(canines),
      intermolar: span(firstMolars),
      depth:
        incisors[jaw] && firstMolars && forward
          ? dot(sub(incisors[jaw].middle, firstMolars.middle), forward)
          : null,
      length: widths.every((width) => width !== null)
        ? 2 * widths.reduce((sum, width) => sum + width, 0)
        : null,
    };
  };
  const between =
    incisors.upper && incisors.lower && forward
      ? sub(incisors.upper.middle, incisors.lower.middle)
      : null;
  return {
    upper: arch('upper'),
    lower: arch('lower'),
    overjet: between ? dot(between, forward) : null,
    overbite: between ? -dot(between, up) : null,
  };
}
