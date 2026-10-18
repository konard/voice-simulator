/**
 * Level-of-detail reduction of detailed meshes (scans, atlases) by vertex
 * clustering: vertices that fall into the same cube of a grid merge into
 * their mean, and triangles whose corners merge vanish. It keeps the shape
 * to within about one cube, needs no connectivity, runs in linear time and
 * gives the same result on every runtime, so a full-resolution source can
 * be scaled down for every LOD of the head model.
 */

/**
 * A mesh with its vertices clustered into cubes of `cell` (in the mesh's
 * units). `cell` <= 0 returns a copy.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {number} cell
 * @returns {{positions: Float32Array, indices: Uint32Array}}
 */
export function clusterVertices(mesh, cell) {
  const { positions, indices } = mesh;
  if (!(cell > 0)) {
    return {
      positions: Float32Array.from(positions),
      indices: Uint32Array.from(indices),
    };
  }
  const clusters = new Map();
  const sums = [];
  const counts = [];
  const remap = new Uint32Array(positions.length / 3);
  for (let vertex = 0; vertex < remap.length; vertex++) {
    const point = [0, 1, 2].map((axis) => positions[vertex * 3 + axis]);
    const key = point.map((value) => Math.floor(value / cell)).join(',');
    let cluster = clusters.get(key);
    if (cluster === undefined) {
      cluster = counts.length;
      clusters.set(key, cluster);
      sums.push(0, 0, 0);
      counts.push(0);
    }
    point.forEach((value, axis) => {
      sums[cluster * 3 + axis] += value;
    });
    counts[cluster] += 1;
    remap[vertex] = cluster;
  }
  const kept = [];
  const seen = new Set();
  for (let index = 0; index < indices.length; index += 3) {
    const corners = [0, 1, 2].map((corner) => remap[indices[index + corner]]);
    const [a, b, c] = corners;
    if (a === b || b === c || a === c) {
      continue;
    }
    // One copy of each triangle, whatever corner it starts at.
    const first = corners.indexOf(Math.min(a, b, c));
    const key = [0, 1, 2].map((step) => corners[(first + step) % 3]).join(',');
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(a, b, c);
    }
  }
  return {
    positions: Float32Array.from(
      sums,
      (sum, index) => sum / counts[Math.floor(index / 3)]
    ),
    indices: Uint32Array.from(kept),
  };
}
