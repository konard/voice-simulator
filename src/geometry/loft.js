/**
 * Closed lofted meshes: rings of points swept along a path with a centre
 * vertex capping each end. The teeth, tongue, palate and lips are built
 * this way so every part is a closed solid that slices into closed
 * outlines.
 */

const indexCache = new Map();

function loftIndices(sections, ring) {
  const indices = [];
  for (let section = 0; section < sections - 1; section++) {
    for (let step = 0; step < ring; step++) {
      const a = section * ring + step;
      const b = section * ring + ((step + 1) % ring);
      indices.push(a, a + ring, b, b, a + ring, b + ring);
    }
  }
  const first = sections * ring;
  const last = first + 1;
  const end = (sections - 1) * ring;
  for (let step = 0; step < ring; step++) {
    const next = (step + 1) % ring;
    indices.push(first, next, step, last, end + step, end + next);
  }
  return Uint32Array.from(indices);
}

/**
 * Closed mesh swept through `sections` rings of `ring` points, with a
 * centre vertex capping each end.
 * @param {number} sections
 * @param {number} ring
 * @param {(section: number, step: number) => number[]} vertex
 * @returns {{positions: Float32Array, indices: Uint32Array}}
 */
export function loftMesh(sections, ring, vertex) {
  const positions = new Float32Array((sections * ring + 2) * 3);
  for (let section = 0; section < sections; section++) {
    for (let step = 0; step < ring; step++) {
      positions.set(vertex(section, step), (section * ring + step) * 3);
    }
  }
  for (const [cap, section] of [
    [sections * ring, 0],
    [sections * ring + 1, sections - 1],
  ]) {
    for (let axis = 0; axis < 3; axis++) {
      let sum = 0;
      for (let step = 0; step < ring; step++) {
        sum += positions[(section * ring + step) * 3 + axis];
      }
      positions[cap * 3 + axis] = sum / ring;
    }
  }
  const key = `${sections} ${ring}`;
  let indices = indexCache.get(key);
  if (!indices) {
    if (indexCache.size >= 64) {
      indexCache.clear();
    }
    indices = loftIndices(sections, ring);
    indexCache.set(key, indices);
  }
  return { positions, indices: indices.slice() };
}

/**
 * Several meshes as one.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}[]} meshes
 */
export function mergeMeshes(meshes) {
  const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0);
  const count = meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const positions = new Float32Array(vertices);
  const indices = new Uint32Array(count);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, vertexOffset);
    const base = vertexOffset / 3;
    for (let index = 0; index < mesh.indices.length; index++) {
      indices[indexOffset + index] = mesh.indices[index] + base;
    }
    vertexOffset += mesh.positions.length;
    indexOffset += mesh.indices.length;
  }
  return { positions, indices };
}
