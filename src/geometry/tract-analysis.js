/**
 * Centreline and area function of a vocal tract surface mesh: the tract
 * is followed from the glottis cut to the lip cut by slicing it with
 * planes normal to the current direction; the cross-section containing
 * the centreline gives the area and the next centre (the usual
 * cross-sectional centroid method for MRI vocal tracts, e.g. Story,
 * Titze and Hoffman 1996).
 *
 * Works on the open inner surfaces of the Dresden Vocal Tract Dataset (in
 * millimetres) and on the model's own tract tube, so both can be compared
 * section by section.
 */

import { boundaryLoops, chainSegments, loopShape, sliceMesh } from './slice.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, scale = 1) => [
  a[0] + b[0] * scale,
  a[1] + b[1] * scale,
  a[2] + b[2] * scale,
];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a) => {
  const length = Math.hypot(...a) || 1;
  return a.map((value) => value / length);
};

/** Two unit vectors spanning the plane normal to `normal`. */
export function planeBasis(normal) {
  const helper = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(normal, helper));
  return [u, cross(normal, u)];
}

/**
 * Area, centroid and containment test of a closed planar polyline.
 * @param {number[][]} points 3D points (first repeated at the end or not).
 * @param {number[]} origin A point of the plane.
 * @param {number[][]} basis Two unit vectors of the plane.
 */
export function planarPolygon(points, origin, basis) {
  const flat = points.map((point) => {
    const offset = sub(point, origin);
    return [dot(offset, basis[0]), dot(offset, basis[1])];
  });
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < flat.length; index++) {
    const [x0, y0] = flat[index];
    const [x1, y1] = flat[(index + 1) % flat.length];
    const term = x0 * y1 - x1 * y0;
    twice += term;
    cx += (x0 + x1) * term;
    cy += (y0 + y1) * term;
  }
  const area = Math.abs(twice) / 2;
  const centroid2 = twice ? [cx / (3 * twice), cy / (3 * twice)] : [0, 0];
  const contains = ([px, py]) => {
    let inside = false;
    for (let a = 0, b = flat.length - 1; a < flat.length; b = a++) {
      const [xa, ya] = flat[a];
      const [xb, yb] = flat[b];
      if (
        ya > py !== yb > py &&
        px < ((xb - xa) * (py - ya)) / (yb - ya) + xa
      ) {
        inside = !inside;
      }
    }
    return inside;
  };
  return {
    area,
    flat,
    contains,
    centroid: add(add(origin, basis[0], centroid2[0]), basis[1], centroid2[1]),
  };
}

/**
 * The cross-section of a mesh in a plane that contains a point: the
 * smallest closed slice polygon around it.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {number[]} point
 * @param {number[]} normal Unit normal of the plane.
 * @param {number} [tolerance] Chaining tolerance in mesh units.
 * @returns {{area: number, centroid: number[], points: number[][]} | null}
 */
export function crossSection(mesh, point, normal, tolerance = 1e-5) {
  const basis = planeBasis(normal);
  const lines = chainSegments(
    sliceMesh(mesh, { normal, offset: dot(normal, point) }),
    tolerance
  );
  let best = null;
  for (const line of lines) {
    if (line.length < 4) {
      continue;
    }
    const polygon = planarPolygon(line, point, basis);
    if (polygon.contains([0, 0]) && (!best || polygon.area < best.area)) {
      best = { area: polygon.area, centroid: polygon.centroid, points: line };
    }
  }
  return best;
}

/**
 * Glottis and lip openings of an open tract surface: the two largest
 * boundary loops, the lower one in `up` being the glottis.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {number[]} up Unit vector pointing upwards in mesh coordinates.
 */
export function tractOpenings(mesh, up) {
  const [first, second] = boundaryLoops(mesh)
    .slice(0, 2)
    .map((loop) => loopShape(mesh, loop));
  const [glottis, lips] =
    dot(first.center, up) < dot(second.center, up)
      ? [first, second]
      : [second, first];
  return { glottis, lips };
}

/**
 * Resample a polyline at equal arc length after a moving-average
 * smoothing over `window` points.
 * @param {number[][]} points
 * @param {number} step Arc length between samples.
 * @param {number} [window]
 */
export function resamplePath(points, step, window = 5) {
  const half = Math.floor(window / 2);
  const smooth = points.map((_, index) => {
    if (index === 0 || index === points.length - 1) {
      return points[index];
    }
    const reach = Math.min(half, index, points.length - 1 - index);
    const sum = [0, 0, 0];
    for (let k = index - reach; k <= index + reach; k++) {
      for (let axis = 0; axis < 3; axis++) {
        sum[axis] += points[k][axis];
      }
    }
    return sum.map((value) => value / (2 * reach + 1));
  });
  const distances = [0];
  for (let index = 1; index < smooth.length; index++) {
    distances.push(
      distances[index - 1] +
        Math.hypot(...sub(smooth[index], smooth[index - 1]))
    );
  }
  const length = distances.at(-1);
  const count = Math.max(2, Math.round(length / step) + 1);
  const samples = [];
  let segment = 0;
  for (let index = 0; index < count; index++) {
    const target = (index / (count - 1)) * length;
    while (segment < smooth.length - 2 && distances[segment + 1] < target) {
      segment++;
    }
    const span = distances[segment + 1] - distances[segment] || 1;
    const t = (target - distances[segment]) / span;
    samples.push(
      add(smooth[segment], sub(smooth[segment + 1], smooth[segment]), t)
    );
  }
  return { points: samples, length };
}

/**
 * Area function of a tract surface along a centreline (for instance a
 * medial path from voxelize.js running from the glottis to the lips):
 * the cross-section normal to the path at every `step` of arc length.
 * The first and last samples are dropped, since the cuts are planar
 * there.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {number[][]} path
 * @param {{step: number, window?: number}} options
 * @returns {{points: number[][], directions: number[][], areas: number[],
 *   distances: number[], length: number}}
 */
export function areaFunction(mesh, path, options) {
  const { points, length } = resamplePath(path, options.step, options.window);
  const spacing = length / (points.length - 1);
  const result = {
    points: [],
    directions: [],
    areas: [],
    distances: [],
    length,
  };
  for (let index = 1; index < points.length - 1; index++) {
    const direction = unit(sub(points[index + 1], points[index - 1]));
    const section = crossSection(mesh, points[index], direction);
    if (section) {
      result.points.push(points[index]);
      result.directions.push(direction);
      result.areas.push(section.area);
      result.distances.push(index * spacing);
    }
  }
  return result;
}
