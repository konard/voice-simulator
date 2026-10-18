/**
 * Low-poly meshes for the 3D view and for export (OBJ opens in Blender):
 * the head surface, the vocal/nasal tract tubes and the lips. Only shapes
 * that matter acoustically are modelled: the outer head (it diffracts the
 * radiated sound), the tract walls, the nose and the lip opening.
 *
 * The head is an implicit surface (smooth union of ellipsoids); the same
 * function is used by the 3D wave solver to decide which voxels are solid.
 */

import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import {
  headLandmarks,
  templatePosition,
  templateValue,
} from './centerline.js';
import { TRACT_TEMPLATE } from './tract-template.js';

/** Level-of-detail resolutions: [latitude rings, longitude segments, tube ring]. */
export const MESH_LODS = Object.freeze([
  Object.freeze({ rings: 8, segments: 12, tube: 6 }),
  Object.freeze({ rings: 12, segments: 18, tube: 8 }),
  Object.freeze({ rings: 18, segments: 28, tube: 12 }),
  Object.freeze({ rings: 28, segments: 44, tube: 16 }),
]);

function headParts(head) {
  const width = head.headWidth;
  const height = head.headHeight;
  const { lips } = headLandmarks(head);
  return [
    { center: [0, 1.5 * height, -0.6], radii: [7.6 * width, 9.6 * height, 10] },
    {
      center: [0, lips[1] + 1.4 * height, lips[2] - 6.2],
      radii: [5.9 * width, 6.4 * height, 6.3],
    },
    {
      center: [0, -16 * height, -0.6],
      radii: [5.4 * width, 8.5 * height, 5.8],
    },
    {
      center: [0, lips[1] + 2.9 * height, lips[2] + 0.5 * head.noseLength],
      radii: [1.4, 2.3 * height, 1.3 * head.noseLength],
    },
  ];
}

function ellipsoidField(point, { center, radii }) {
  let sum = 0;
  for (let axis = 0; axis < 3; axis++) {
    sum += ((point[axis] - center[axis]) / radii[axis]) ** 2;
  }
  return (Math.sqrt(sum) - 1) * Math.min(...radii);
}

function smoothMin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

/**
 * Approximate signed distance to the head surface (cm, negative inside).
 * @param {Record<string, number>} head Normalised head config.
 * @returns {(point: number[]) => number}
 */
export function headField(head = DEFAULT_HEAD) {
  const parts = headParts(normalizeHeadConfig(head));
  return (point) => {
    let value = ellipsoidField(point, parts[0]);
    for (let index = 1; index < parts.length; index++) {
      value = smoothMin(value, ellipsoidField(point, parts[index]), 1.2);
    }
    return value;
  };
}

function surfaceRadius(field, origin, direction) {
  let low = 0;
  let high = 40;
  for (let iteration = 0; iteration < 22; iteration++) {
    const middle = (low + high) / 2;
    const point = origin.map((value, axis) => value + direction[axis] * middle);
    if (field(point) < 0) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Low-poly head surface (latitude/longitude grid around a central point).
 * @param {Record<string, number>} head
 * @param {{lod?: number}} [options]
 * @returns {{positions: Float32Array, indices: Uint32Array, rings: number, segments: number}}
 */
export function headMesh(head = DEFAULT_HEAD, options = {}) {
  const config = normalizeHeadConfig(head);
  const { rings, segments } = MESH_LODS[options.lod ?? 1];
  const field = headField(config);
  const origin = [0, -3 * config.headHeight, 1.5];
  const positions = new Float32Array(((rings - 1) * segments + 2) * 3);
  const poles = [-1, 1].map((sign) => {
    const radius = surfaceRadius(field, origin, [0, sign, 0]);
    return [origin[0], origin[1] + sign * radius, origin[2]];
  });
  positions.set(poles[1], 0);
  let offset = 3;
  for (let ring = 1; ring < rings; ring++) {
    const polar = (Math.PI * ring) / rings;
    for (let segment = 0; segment < segments; segment++) {
      const azimuth = (2 * Math.PI * segment) / segments;
      const direction = [
        Math.sin(polar) * Math.sin(azimuth),
        Math.cos(polar),
        Math.sin(polar) * Math.cos(azimuth),
      ];
      const radius = surfaceRadius(field, origin, direction);
      for (let axis = 0; axis < 3; axis++) {
        positions[offset++] = origin[axis] + direction[axis] * radius;
      }
    }
  }
  positions.set(poles[0], offset);
  return {
    positions,
    indices: sphereIndices(rings, segments),
    rings,
    segments,
  };
}

function sphereIndices(rings, segments) {
  const indices = [];
  const vertex = (ring, segment) =>
    1 + (ring - 1) * segments + (segment % segments);
  const bottom = 1 + (rings - 1) * segments;
  for (let segment = 0; segment < segments; segment++) {
    indices.push(0, vertex(1, segment + 1), vertex(1, segment));
    indices.push(
      bottom,
      vertex(rings - 1, segment),
      vertex(rings - 1, segment + 1)
    );
    for (let ring = 1; ring < rings - 1; ring++) {
      const a = vertex(ring, segment);
      const b = vertex(ring, segment + 1);
      const c = vertex(ring + 1, segment);
      const d = vertex(ring + 1, segment + 1);
      indices.push(a, b, c, b, d, c);
    }
  }
  return Uint32Array.from(indices);
}

/**
 * Lateral and midsagittal semi-axes (cm) of an elliptical section.
 * @param {number} area cm².
 * @param {number} aspect Lateral over midsagittal width.
 */
export function ellipseAxes(area, aspect) {
  const minor = Math.sqrt(Math.max(area, 1e-4) / (Math.PI * aspect));
  return [minor * aspect, minor];
}

/** Width-to-height ratio of the nasal passage sections. */
export const NOSE_ASPECT = 1.3;

/**
 * Lateral and midsagittal semi-axes (cm) of a nasal passage section.
 * @param {number} area cm².
 */
export function noseAxes(area) {
  return ellipseAxes(area, NOSE_ASPECT);
}

/**
 * Lateral and midsagittal semi-axes (cm) of a tract cross-section, with
 * the width-to-depth ratio of MRI tracts (tract-template.js): round at
 * the glottis, wide in the lower pharynx, flat under the palate. Near the
 * lips the opening keeps the mouth width and only its height follows the
 * area (a slit).
 * @param {number} area cm².
 * @param {number} position 0 = glottis, 1 = lips.
 * @param {Record<string, number>} head
 */
export function sectionAxes(area, position, head = DEFAULT_HEAD) {
  const safe = Math.max(area, 1e-4);
  let aspect = templateValue(
    TRACT_TEMPLATE.aspects,
    templatePosition(position, head.pharynxRatio)
  );
  if (position > 0.9) {
    const halfWidth = 1.25 * head.mouthWidth;
    const slit = (Math.PI * halfWidth * halfWidth) / safe;
    const blend = (position - 0.9) / 0.1;
    aspect = aspect * (1 - blend) + Math.max(1, Math.min(14, slit)) * blend;
  }
  return ellipseAxes(safe, aspect);
}

/** Linear interpolation of a per-section table at a relative position. */
function sampleAt(values, position) {
  const source = Math.min(1, Math.max(0, position)) * (values.length - 1);
  const lower = Math.floor(source);
  const upper = Math.min(values.length - 1, lower + 1);
  return values[lower] + (values[upper] - values[lower]) * (source - lower);
}

function smoothstep(low, high, value) {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

/**
 * Tract sections whose upper wall (the palate, and the back wall of the
 * pharynx) stays where it is at rest, so a narrower or wider section moves
 * the tongue side only: semi-axes as sectionAxes() plus the `shift` (cm)
 * of the section centre towards the upper wall. The larynx and the lips
 * close from both sides, so the shift fades out at both ends.
 * @param {Record<string, number>} head
 * @param {ArrayLike<number>} restAreas Area function at rest, e.g.
 *   tractShape({}, head).areas.
 * @returns {(area: number, position: number) => number[]}
 */
export function tractAxes(head, restAreas) {
  const config = normalizeHeadConfig(head);
  return (area, position) => {
    const [major, minor] = sectionAxes(area, position, config);
    const [, rest] = sectionAxes(
      sampleAt(restAreas, position),
      position,
      config
    );
    const hold =
      smoothstep(0.04, 0.16, position) * (1 - smoothstep(0.88, 0.98, position));
    return [major, minor, (rest - minor) * hold];
  };
}

function frame(tangent) {
  const side = [1, 0, 0];
  const normal = [
    tangent[1] * side[2] - tangent[2] * side[1],
    tangent[2] * side[0] - tangent[0] * side[2],
    tangent[0] * side[1] - tangent[1] * side[0],
  ];
  return { side, normal };
}

/**
 * Elliptical tube around a centreline (open at both ends).
 * @param {{points: Float64Array, tangents: Float64Array, count: number}} path
 * @param {ArrayLike<number>} areas One area per section (resampled if needed).
 * @param {{lod?: number, head?: Record<string, number>, axes?: (area: number, position: number) => number[]}} [options]
 *   `axes` gives the lateral and midsagittal semi-axes of a section and
 *   optionally a shift of its centre along the upper normal.
 */
export function tubeMesh(path, areas, options = {}) {
  const ring = MESH_LODS[options.lod ?? 1].tube;
  const positions = new Float32Array(path.count * ring * 3);
  const mesh = { positions, indices: tubeIndices(path.count, ring), ring };
  updateTubeMesh(mesh, path, areas, options);
  return mesh;
}

/**
 * Rewrite tube vertex positions in place for new areas (per animation frame).
 */
export function updateTubeMesh(mesh, path, areas, options = {}) {
  const head = options.head ?? DEFAULT_HEAD;
  const axes =
    options.axes ?? ((area, position) => sectionAxes(area, position, head));
  const { ring, positions } = mesh;
  for (let section = 0; section < path.count; section++) {
    const position = path.count > 1 ? section / (path.count - 1) : 0;
    const [major, minor, shift = 0] = axes(sampleAt(areas, position), position);
    const tangent = path.tangents.subarray(section * 3, section * 3 + 3);
    const { side, normal } = frame(tangent);
    for (let step = 0; step < ring; step++) {
      const angle = (2 * Math.PI * step) / ring;
      const u = Math.cos(angle) * major;
      const v = Math.sin(angle) * minor + shift;
      const offset = (section * ring + step) * 3;
      for (let axis = 0; axis < 3; axis++) {
        positions[offset + axis] =
          path.points[section * 3 + axis] + side[axis] * u + normal[axis] * v;
      }
    }
  }
  return mesh;
}

function tubeIndices(count, ring) {
  const indices = [];
  for (let section = 0; section < count - 1; section++) {
    for (let step = 0; step < ring; step++) {
      const a = section * ring + step;
      const b = section * ring + ((step + 1) % ring);
      const c = a + ring;
      const d = b + ring;
      indices.push(a, c, b, b, c, d);
    }
  }
  return Uint32Array.from(indices);
}

/**
 * Bend the lower face around the jaw joint. Works on a copy of the base
 * positions so repeated calls do not accumulate.
 * @param {Float32Array} base Rest positions.
 * @param {Float32Array} target Output positions.
 * @param {Record<string, number>} head
 * @param {number} openness 0 = closed, 1 = fully open jaw.
 */
export function deformJaw(base, target, head, openness) {
  const config = normalizeHeadConfig(head);
  const { lips, jawPivot } = headLandmarks(config);
  const angle = openness * 0.22 * config.jawRange;
  for (let index = 0; index < base.length; index += 3) {
    const y = base[index + 1];
    const z = base[index + 2];
    const below = Math.min(1, Math.max(0, (lips[1] + 0.4 - y) / 1.2));
    const front = Math.min(1, Math.max(0, (z - 1) / 3));
    const chin = Math.min(1, Math.max(0, (y - (lips[1] - 9)) / 2.5));
    const theta = angle * below * front * chin;
    const dy = y - jawPivot[1];
    const dz = z - jawPivot[2];
    target[index] = base[index];
    target[index + 1] =
      jawPivot[1] + dy * Math.cos(theta) - dz * Math.sin(theta);
    target[index + 2] =
      jawPivot[2] + dy * Math.sin(theta) + dz * Math.cos(theta);
  }
  return target;
}

/**
 * Wavefront OBJ text for named meshes.
 * @param {{name: string, positions: ArrayLike<number>, indices: ArrayLike<number>}[]} meshes
 */
export function meshesToObj(meshes) {
  const lines = ['# voice-simulator head model (units: cm)'];
  let base = 1;
  for (const mesh of meshes) {
    lines.push(`o ${mesh.name}`);
    for (let index = 0; index < mesh.positions.length; index += 3) {
      const [x, y, z] = [0, 1, 2].map((axis) =>
        Number(mesh.positions[index + axis].toFixed(4))
      );
      lines.push(`v ${x} ${y} ${z}`);
    }
    for (let index = 0; index < mesh.indices.length; index += 3) {
      lines.push(
        `f ${mesh.indices[index] + base} ${mesh.indices[index + 1] + base} ${mesh.indices[index + 2] + base}`
      );
    }
    base += mesh.positions.length / 3;
  }
  return `${lines.join('\n')}\n`;
}
