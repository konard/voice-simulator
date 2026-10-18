/**
 * Planar slices and open boundaries of triangle meshes, for comparing the
 * head model with segmented anatomy at any cut (midsagittal, coronal,
 * axial or oblique) and for finding the glottis and lip openings of a
 * segmented vocal tract.
 */

/** Bounding box of a mesh: {min, max} as [x, y, z]. */
export function meshBounds({ positions }) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return { min, max };
}

function vertex(positions, index) {
  return [
    positions[index * 3],
    positions[index * 3 + 1],
    positions[index * 3 + 2],
  ];
}

/**
 * Segments where a mesh crosses the plane normal . p = offset.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {{normal: number[], offset: number}} plane
 * @returns {number[][][]} Pairs of 3D points.
 */
export function sliceMesh({ positions, indices }, { normal, offset }) {
  const distances = new Float64Array(positions.length / 3);
  for (let index = 0; index < distances.length; index++) {
    distances[index] =
      normal[0] * positions[index * 3] +
      normal[1] * positions[index * 3 + 1] +
      normal[2] * positions[index * 3 + 2] -
      offset;
  }
  const segments = [];
  for (let index = 0; index < indices.length; index += 3) {
    const corners = [indices[index], indices[index + 1], indices[index + 2]];
    const below = corners.filter((corner) => distances[corner] < 0).length;
    if (below === 0 || below === 3) {
      continue;
    }
    const crossings = [];
    for (let edge = 0; edge < 3; edge++) {
      const a = corners[edge];
      const b = corners[(edge + 1) % 3];
      if (distances[a] < 0 !== distances[b] < 0) {
        const t = distances[a] / (distances[a] - distances[b]);
        const start = vertex(positions, a);
        const end = vertex(positions, b);
        crossings.push(
          start.map((value, axis) => value + t * (end[axis] - value))
        );
      }
    }
    segments.push(crossings);
  }
  return segments;
}

/** Axis-aligned plane through `offset` on axis 0 (x), 1 (y) or 2 (z). */
export function axisPlane(axis, offset) {
  const normal = [0, 0, 0];
  normal[axis] = 1;
  return { normal, offset };
}

/**
 * Loops of edges used by a single triangle: the open ends of a surface
 * (for a segmented vocal tract, the glottis and lip cuts).
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @returns {number[][]} Vertex indices of each loop, largest first.
 */
export function boundaryLoops({ indices }) {
  const edges = new Map();
  for (let index = 0; index < indices.length; index += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = indices[index + edge];
      const b = indices[index + ((edge + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, edges.has(key) ? null : [a, b]);
    }
  }
  const next = new Map();
  for (const edge of edges.values()) {
    if (edge) {
      next.set(edge[0], [...(next.get(edge[0]) ?? []), edge[1]]);
      next.set(edge[1], [...(next.get(edge[1]) ?? []), edge[0]]);
    }
  }
  const visited = new Set();
  const loops = [];
  for (const start of next.keys()) {
    if (visited.has(start)) {
      continue;
    }
    const loop = [];
    let current = start;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      loop.push(current);
      current = next.get(current).find((other) => !visited.has(other));
    }
    loops.push(loop);
  }
  return loops.sort((a, b) => b.length - a.length);
}

/**
 * Centroid, principal extents and normal of a closed loop of vertices.
 * @param {{positions: ArrayLike<number>}} mesh
 * @param {number[]} loop
 * @returns {{center: number[], normal: number[], area: number, points: number[][]}}
 */
export function loopShape({ positions }, loop) {
  const points = loop.map((index) => vertex(positions, index));
  const center = [0, 1, 2].map(
    (axis) =>
      points.reduce((sum, point) => sum + point[axis], 0) / points.length
  );
  const normal = [0, 0, 0];
  for (let index = 0; index < points.length; index++) {
    const a = points[index].map((value, axis) => value - center[axis]);
    const b = points[(index + 1) % points.length].map(
      (value, axis) => value - center[axis]
    );
    normal[0] += a[1] * b[2] - a[2] * b[1];
    normal[1] += a[2] * b[0] - a[0] * b[2];
    normal[2] += a[0] * b[1] - a[1] * b[0];
  }
  const twice = Math.hypot(...normal);
  return {
    center,
    normal: normal.map((value) => value / (twice || 1)),
    area: twice / 2,
    points,
  };
}

/**
 * Join slice segments into polylines (closed ones repeat the first point).
 * @param {number[][][]} segments
 * @param {number} [tolerance] Distance under which two ends are the same point.
 * @returns {number[][][]}
 */
export function chainSegments(segments, tolerance = 1e-6) {
  const key = (point) =>
    point.map((value) => Math.round(value / tolerance)).join(',');
  const ends = new Map();
  segments.forEach((segment, index) => {
    for (const point of segment) {
      const name = key(point);
      ends.set(name, [...(ends.get(name) ?? []), index]);
    }
  });
  const used = new Set();
  const lines = [];
  const extend = (line) => {
    for (;;) {
      const last = line.at(-1);
      const index = (ends.get(key(last)) ?? []).find((s) => !used.has(s));
      if (index === undefined) {
        return;
      }
      used.add(index);
      const [a, b] = segments[index];
      line.push(key(a) === key(last) ? b : a);
    }
  };
  segments.forEach((segment, index) => {
    if (used.has(index)) {
      return;
    }
    used.add(index);
    const line = [...segment];
    extend(line);
    line.reverse();
    extend(line);
    lines.push(line);
  });
  return lines;
}
