/**
 * Binary glTF 2.0 (.glb) of named meshes, the format Blender, three.js and
 * most 3D tools import with materials: one node, mesh and material per
 * part, with smooth vertex normals. glTF is in metres with +y up and +z
 * forward, the axes of the head frame, so only the scale changes.
 */

/** Part colours (sRGB) and roughness, as the 3D viewer draws them. */
export const PART_MATERIALS = Object.freeze({
  head: { color: 0xe8b796, roughness: 0.8, opacity: 0.25 },
  tract: { color: 0x3a6fd8, roughness: 0.5 },
  nose: { color: 0x5a8ae0, roughness: 0.5 },
  lips: { color: 0xc0505a, roughness: 0.6 },
  upperTeeth: { color: 0xf2ead8, roughness: 0.35 },
  lowerTeeth: { color: 0xf2ead8, roughness: 0.35 },
  tongue: { color: 0xc4646e, roughness: 0.7 },
  palate: { color: 0xd88a8a, roughness: 0.6 },
  velum: { color: 0xd47d84, roughness: 0.6 },
});

const FALLBACK = { color: 0xb0b0b0, roughness: 0.6 };
const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** sRGB byte to the linear factor glTF materials expect. */
function linear(byte) {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function material(name) {
  const { color, roughness, opacity = 1 } = PART_MATERIALS[name] ?? FALLBACK;
  const rgb = [16, 8, 0].map((shift) => linear((color >> shift) & 0xff));
  return {
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [...rgb, opacity],
      metallicFactor: 0,
      roughnessFactor: roughness,
    },
    doubleSided: true,
    ...(opacity < 1 ? { alphaMode: 'BLEND' } : {}),
  };
}

/** Area-weighted unit vertex normals. */
export function vertexNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = [0, 1, 2].map((corner) => indices[index + corner] * 3);
    const u = [0, 1, 2].map(
      (axis) => positions[b + axis] - positions[a + axis]
    );
    const v = [0, 1, 2].map(
      (axis) => positions[c + axis] - positions[a + axis]
    );
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    for (const vertex of [a, b, c]) {
      for (let axis = 0; axis < 3; axis++) {
        normals[vertex + axis] += normal[axis];
      }
    }
  }
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(
      normals[index],
      normals[index + 1],
      normals[index + 2]
    );
    for (let axis = 0; axis < 3; axis++) {
      normals[index + axis] = length > 0 ? normals[index + axis] / length : 0;
    }
  }
  return normals;
}

/** Byte length rounded up to the 4-byte alignment glTF requires. */
const padded = (length) => Math.ceil(length / 4) * 4;

/**
 * @param {{name: string, positions: ArrayLike<number>, indices: ArrayLike<number>}[]} meshes
 * @param {{scale?: number, generator?: string}} [options] `scale`
 *   multiplies the coordinates (default 0.01: centimetres to metres).
 * @returns {Uint8Array}
 */
export function meshesToGlb(meshes, options = {}) {
  const scale = options.scale ?? 0.01;
  const views = [];
  const accessors = [];
  const chunks = [];
  let offset = 0;
  const addView = (array, target) => {
    const bytes = new Uint8Array(
      array.buffer,
      array.byteOffset,
      array.byteLength
    );
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
      target,
    });
    chunks.push({ offset, bytes });
    offset += padded(bytes.length);
    return views.length - 1;
  };
  const gltfMeshes = meshes.map((mesh, index) => {
    const positions = Float32Array.from(
      mesh.positions,
      (value) => value * scale
    );
    const indices = Uint32Array.from(mesh.indices);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < positions.length; at += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], positions[at + axis]);
        max[axis] = Math.max(max[axis], positions[at + axis]);
      }
    }
    const count = positions.length / 3;
    accessors.push(
      {
        bufferView: addView(positions, ARRAY_BUFFER),
        componentType: FLOAT,
        count,
        type: 'VEC3',
        min,
        max,
      },
      {
        bufferView: addView(vertexNormals(positions, indices), ARRAY_BUFFER),
        componentType: FLOAT,
        count,
        type: 'VEC3',
      },
      {
        bufferView: addView(indices, ELEMENT_ARRAY_BUFFER),
        componentType: UNSIGNED_INT,
        count: indices.length,
        type: 'SCALAR',
      }
    );
    const first = accessors.length - 3;
    return {
      name: mesh.name,
      primitives: [
        {
          attributes: { POSITION: first, NORMAL: first + 1 },
          indices: first + 2,
          material: index,
        },
      ],
    };
  });
  const json = {
    asset: {
      version: '2.0',
      generator: options.generator ?? 'voice-simulator',
    },
    scene: 0,
    scenes: [{ name: 'head', nodes: meshes.map((_, index) => index) }],
    nodes: meshes.map((mesh, index) => ({ name: mesh.name, mesh: index })),
    meshes: gltfMeshes,
    materials: meshes.map((mesh) => material(mesh.name)),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  const text = new globalThis.TextEncoder().encode(JSON.stringify(json));
  const jsonLength = padded(text.length);
  const total = 12 + 8 + jsonLength + 8 + offset;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  bytes.set(text, 20);
  // The JSON chunk is padded with spaces, the binary chunk with zeros.
  bytes.fill(0x20, 20 + text.length, 20 + jsonLength);
  const bin = 20 + jsonLength;
  view.setUint32(bin, offset, true);
  view.setUint32(bin + 4, BIN_CHUNK, true);
  for (const chunk of chunks) {
    bytes.set(chunk.bytes, bin + 8 + chunk.offset);
  }
  return bytes;
}

/**
 * Read back a .glb written by meshesToGlb: its JSON and the named meshes
 * in the file's units.
 * @param {Uint8Array} bytes
 */
export function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('not a glTF 2.0 binary');
  }
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new globalThis.TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))
  );
  const bin = bytes.byteOffset + 20 + jsonLength + 8;
  const read = (accessor, Type) => {
    const { byteOffset, byteLength } = json.bufferViews[accessor.bufferView];
    return new Type(
      bytes.buffer.slice(bin + byteOffset, bin + byteOffset + byteLength)
    );
  };
  const meshes = json.meshes.map((mesh) => {
    const [primitive] = mesh.primitives;
    return {
      name: mesh.name,
      positions: read(
        json.accessors[primitive.attributes.POSITION],
        Float32Array
      ),
      normals: read(json.accessors[primitive.attributes.NORMAL], Float32Array),
      indices: read(json.accessors[primitive.indices], Uint32Array),
    };
  });
  return { json, meshes };
}
