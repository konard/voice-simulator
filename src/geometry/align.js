/**
 * Rigid alignment of point sets and meshes, and distances between
 * curves: the head model and segmented anatomy are brought into one
 * frame and compared by how far their centrelines and outlines lie apart.
 */

/**
 * Dresden Vocal Tract Dataset millimetres (+z superior, +y anterior) to
 * head centimetres (+y up, +z forward): a proper rotation, so shapes are
 * not mirrored.
 */
export const DVTD_TO_HEAD = Object.freeze({
  rotation: [
    [-1, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  translation: [0, 0, 0],
  scale: 0.1,
});

/**
 * Apply `scale * rotation * point + translation`.
 * @param {number[]} point
 * @param {{rotation: number[][], translation: number[], scale?: number}} transform
 */
export function transformPoint(point, { rotation, translation, scale = 1 }) {
  return rotation.map(
    (row, axis) =>
      scale * (row[0] * point[0] + row[1] * point[1] + row[2] * point[2]) +
      translation[axis]
  );
}

/**
 * Transformed copy of a mesh.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {{rotation: number[][], translation: number[], scale?: number}} transform
 */
export function transformMesh(mesh, transform) {
  const positions = new Float64Array(mesh.positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    positions.set(
      transformPoint(
        [
          mesh.positions[index],
          mesh.positions[index + 1],
          mesh.positions[index + 2],
        ],
        transform
      ),
      index
    );
  }
  return { ...mesh, positions };
}

/**
 * Compose two transforms: `second` applied after `first`.
 */
export function composeTransforms(first, second) {
  const scale = (first.scale ?? 1) * (second.scale ?? 1);
  const rotation = second.rotation.map((row) =>
    [0, 1, 2].map((column) =>
      row.reduce((sum, value, k) => sum + value * first.rotation[k][column], 0)
    )
  );
  return {
    rotation,
    translation: transformPoint(first.translation, second),
    scale,
  };
}

/** Eigenvector of the largest eigenvalue of a symmetric matrix (Jacobi). */
function principalEigenvector(matrix) {
  const size = matrix.length;
  const a = matrix.map((row) => [...row]);
  const vectors = a.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < size; p++) {
      for (let q = p + 1; q < size; q++) {
        off += a[p][q] ** 2;
      }
    }
    if (off < 1e-20) {
      break;
    }
    for (let p = 0; p < size; p++) {
      for (let q = p + 1; q < size; q++) {
        if (Math.abs(a[p][q]) < 1e-30) {
          continue;
        }
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.hypot(theta, 1));
        const c = 1 / Math.hypot(t, 1);
        const s = t * c;
        for (let k = 0; k < size; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < size; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < size; k++) {
          const vkp = vectors[k][p];
          const vkq = vectors[k][q];
          vectors[k][p] = c * vkp - s * vkq;
          vectors[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let k = 1; k < size; k++) {
    if (a[k][k] > a[best][best]) {
      best = k;
    }
  }
  return vectors.map((row) => row[best]);
}

const mean = (points) =>
  [0, 1, 2].map(
    (axis) =>
      points.reduce((sum, point) => sum + point[axis], 0) / points.length
  );

/**
 * Rotation and translation that move `source` points onto the matching
 * `target` points with the least squared error (Horn 1987, unit
 * quaternions).
 * @param {number[][]} source
 * @param {number[][]} target
 * @returns {{rotation: number[][], translation: number[], scale: number, rms: number}}
 */
export function rigidFit(source, target) {
  const from = mean(source);
  const to = mean(target);
  const s = [0, 1, 2].map(() => [0, 0, 0]);
  source.forEach((point, index) => {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        s[i][j] += (point[i] - from[i]) * (target[index][j] - to[j]);
      }
    }
  });
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = s;
  const [w, x, y, z] = principalEigenvector([
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]);
  const rotation = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  const turned = transformPoint(from, { rotation, translation: [0, 0, 0] });
  const transform = {
    rotation,
    translation: to.map((value, axis) => value - turned[axis]),
    scale: 1,
  };
  const squared = source.reduce((sum, point, index) => {
    const moved = transformPoint(point, transform);
    return sum + Math.hypot(...moved.map((v, a) => v - target[index][a])) ** 2;
  }, 0);
  return { ...transform, rms: Math.sqrt(squared / source.length) };
}

/**
 * Points at `count` equal fractions of a polyline's arc length.
 * @param {number[][]} points
 * @param {number} count
 */
export function resampleCurve(points, count) {
  const distances = [0];
  for (let index = 1; index < points.length; index++) {
    distances.push(
      distances[index - 1] +
        Math.hypot(...points[index].map((v, a) => v - points[index - 1][a]))
    );
  }
  const length = distances.at(-1);
  const samples = [];
  let segment = 0;
  for (let index = 0; index < count; index++) {
    const target = (index / (count - 1)) * length;
    while (segment < points.length - 2 && distances[segment + 1] < target) {
      segment++;
    }
    const span = distances[segment + 1] - distances[segment] || 1;
    const t = Math.min(1, Math.max(0, (target - distances[segment]) / span));
    samples.push(
      points[segment].map(
        (value, axis) => value + t * (points[segment + 1][axis] - value)
      )
    );
  }
  return samples;
}

function nearest(point, others) {
  let best = Infinity;
  for (const other of others) {
    best = Math.min(
      best,
      Math.hypot(...point.map((value, axis) => value - other[axis]))
    );
  }
  return best;
}

/**
 * Symmetric mean distance between two point sets (the chamfer distance):
 * how far, on average, each point of one lies from the other.
 * @param {number[][]} a
 * @param {number[][]} b
 */
export function chamferDistance(a, b) {
  const one = a.reduce((sum, point) => sum + nearest(point, b), 0) / a.length;
  const two = b.reduce((sum, point) => sum + nearest(point, a), 0) / b.length;
  return (one + two) / 2;
}

/**
 * Points along polylines at a spacing of about `step`, so outlines with
 * few long segments and outlines with many short ones weigh the same.
 * @param {number[][][]} lines
 * @param {number} step
 */
export function densify(lines, step) {
  const points = [];
  for (const line of lines) {
    for (let index = 1; index < line.length; index++) {
      const a = line[index - 1];
      const b = line[index];
      const pieces = Math.max(
        1,
        Math.ceil(Math.hypot(...a.map((v, k) => v - b[k])) / step)
      );
      for (let piece = 0; piece < pieces; piece++) {
        const t = piece / pieces;
        points.push(a.map((value, axis) => value + t * (b[axis] - value)));
      }
    }
  }
  return points;
}
