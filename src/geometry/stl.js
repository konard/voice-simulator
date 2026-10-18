/**
 * STL reading and writing, for comparing the head model with segmented
 * vocal tracts (the Dresden Vocal Tract Dataset is distributed as binary
 * STL) and for exporting it to Blender, slicers and 3D printers.
 *
 * Meshes are `{positions, indices}` with three coordinates per vertex and
 * three indices per triangle, like the other geometry modules. Reading
 * merges vertices that share exact coordinates, so the mesh topology
 * (open boundaries such as the lip and glottis cuts) can be analysed.
 */

const HEADER = 80;
const RECORD = 50;

function vertexMerger() {
  const lookup = new Map();
  const positions = [];
  return {
    positions,
    add(x, y, z) {
      const key = `${x},${y},${z}`;
      let index = lookup.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        lookup.set(key, index);
        positions.push(x, y, z);
      }
      return index;
    },
  };
}

function isBinary(bytes) {
  if (bytes.length < HEADER + 4) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(HEADER, true);
  return bytes.length === HEADER + 4 + count * RECORD;
}

function parseBinary(bytes, merger, indices) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(HEADER, true);
  for (let triangle = 0; triangle < count; triangle++) {
    const base = HEADER + 4 + triangle * RECORD + 12;
    for (let corner = 0; corner < 3; corner++) {
      const at = base + corner * 12;
      indices.push(
        merger.add(
          view.getFloat32(at, true),
          view.getFloat32(at + 4, true),
          view.getFloat32(at + 8, true)
        )
      );
    }
  }
}

function parseAscii(text, merger, indices) {
  const pattern = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (const match of text.matchAll(pattern)) {
    indices.push(
      merger.add(Number(match[1]), Number(match[2]), Number(match[3]))
    );
  }
}

/**
 * Parse a binary or ASCII STL file.
 * @param {Uint8Array} bytes
 * @returns {{positions: Float64Array, indices: Uint32Array}}
 */
export function parseStl(bytes) {
  const merger = vertexMerger();
  const indices = [];
  if (isBinary(bytes)) {
    parseBinary(bytes, merger, indices);
  } else {
    parseAscii(new globalThis.TextDecoder().decode(bytes), merger, indices);
  }
  return {
    positions: Float64Array.from(merger.positions),
    indices: Uint32Array.from(indices),
  };
}

/**
 * Binary STL of meshes (all merged into one solid).
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}[]} meshes
 * @param {{scale?: number, header?: string}} [options] `scale` multiplies
 *   the coordinates (10 writes centimetre meshes in millimetres).
 * @returns {Uint8Array}
 */
export function meshesToStl(meshes, options = {}) {
  const scale = options.scale ?? 1;
  const count = meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
  const bytes = new Uint8Array(HEADER + 4 + count * RECORD);
  bytes.set(
    new globalThis.TextEncoder().encode(
      (options.header ?? 'voice-simulator head model').slice(0, HEADER)
    )
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(HEADER, count, true);
  let at = HEADER + 4;
  for (const { positions, indices } of meshes) {
    for (let index = 0; index < indices.length; index += 3) {
      const corners = [0, 1, 2].map((corner) =>
        [0, 1, 2].map(
          (axis) => positions[indices[index + corner] * 3 + axis] * scale
        )
      );
      const normal = triangleNormal(...corners);
      for (const value of [...normal, ...corners.flat()]) {
        view.setFloat32(at, value, true);
        at += 4;
      }
      at += 2;
    }
  }
  return bytes;
}

/**
 * Unit normal of a triangle (zero for a degenerate one).
 * @param {number[]} a
 * @param {number[]} b
 * @param {number[]} c
 */
export function triangleNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(...normal);
  return length > 0 ? normal.map((value) => value / length) : [0, 0, 0];
}
