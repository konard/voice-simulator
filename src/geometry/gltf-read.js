/**
 * Triangle meshes from glTF 2.0 binaries written by other tools (Blender,
 * Maya, three.js and the HuBMAP reference organs): the node hierarchy
 * with TRS or matrix transforms, packed or interleaved accessors with
 * their own offsets, and 8-, 16- or 32-bit indices. Materials, textures,
 * skins and animations are left out.
 *
 * Reading goes through a `read(accessor)` callback, so a large remote file
 * can be read in part: glbJson() needs only the file's first bytes, and
 * accessorRange() tells which bytes of the binary chunk each accessor
 * needs (scripts/fetch-anatomy.mjs fetches only those).
 */

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const TRIANGLES = 4;
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_TYPES = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const IDENTITY = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/** Bytes of the GLB header and JSON chunk header. */
export const GLB_HEADER_BYTES = 20;

/**
 * Length of the JSON chunk of a GLB from its first 20 bytes.
 * @param {Uint8Array} bytes
 */
export function glbJsonLength(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new Error('not a glTF 2.0 binary');
  }
  if (view.getUint32(16, true) !== JSON_CHUNK) {
    throw new Error('the first GLB chunk is not JSON');
  }
  return view.getUint32(12, true);
}

/**
 * The JSON of a GLB and the file offset of its binary chunk's data.
 * @param {Uint8Array} bytes At least the header and the JSON chunk.
 * @returns {{json: object, binOffset: number}}
 */
export function glbJson(bytes) {
  const length = glbJsonLength(bytes);
  const end = GLB_HEADER_BYTES + length;
  if (bytes.length < end) {
    throw new Error(`the GLB JSON chunk needs ${end} bytes`);
  }
  const json = JSON.parse(
    new globalThis.TextDecoder().decode(bytes.subarray(GLB_HEADER_BYTES, end))
  );
  return { json, binOffset: end + 8 };
}

function accessorLayout(json, index) {
  const accessor = json.accessors[index];
  if (accessor.sparse || accessor.bufferView === undefined) {
    throw new Error(`accessor ${index}: sparse accessors are not supported`);
  }
  const view = json.bufferViews[accessor.bufferView];
  if ((view.buffer ?? 0) !== 0) {
    throw new Error(`accessor ${index}: only the GLB binary chunk is read`);
  }
  const Type = COMPONENT_TYPES[accessor.componentType];
  const components = COMPONENTS[accessor.type];
  const element = Type.BYTES_PER_ELEMENT * components;
  const stride = view.byteStride || element;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const length =
    accessor.count === 0 ? 0 : (accessor.count - 1) * stride + element;
  return { accessor, Type, components, stride, start, length };
}

/**
 * Byte range [start, end) of the binary chunk that an accessor reads.
 * @param {object} json
 * @param {number} index
 */
export function accessorRange(json, index) {
  const { start, length } = accessorLayout(json, index);
  return { start, end: start + length };
}

/**
 * Values of an accessor, packed (count * components).
 * @param {object} json
 * @param {number} index
 * @param {Uint8Array} data Bytes of the binary chunk from `dataStart` on.
 * @param {number} [dataStart] Offset of `data` in the binary chunk.
 */
export function readAccessor(json, index, data, dataStart = 0) {
  const { accessor, Type, components, stride, start, length } = accessorLayout(
    json,
    index
  );
  const from = start - dataStart;
  if (from < 0 || from + length > data.length) {
    throw new Error(`accessor ${index} lies outside the bytes given`);
  }
  const view = new DataView(data.buffer, data.byteOffset + from, length);
  const getter = `get${Type.name.replace('Array', '')}`;
  const values = new Type(accessor.count * components);
  for (let element = 0; element < accessor.count; element++) {
    for (let component = 0; component < components; component++) {
      values[element * components + component] = view[getter](
        element * stride + component * Type.BYTES_PER_ELEMENT,
        true
      );
    }
  }
  return values;
}

/** Column-major product of two 4x4 matrices. */
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) {
        out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
      }
    }
  }
  return out;
}

/** Local matrix of a node: its matrix, or translation * rotation * scale. */
export function nodeMatrix(node) {
  if (node.matrix) {
    return [...node.matrix];
  }
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/**
 * World matrix of every node.
 * @param {object} json
 * @returns {number[][]}
 */
export function worldMatrices(json) {
  const nodes = json.nodes ?? [];
  const parents = new Array(nodes.length).fill(-1);
  nodes.forEach((node, index) =>
    (node.children ?? []).forEach((child) => {
      parents[child] = index;
    })
  );
  const world = new Array(nodes.length);
  const resolve = (index) => {
    if (!world[index]) {
      const local = nodeMatrix(nodes[index]);
      world[index] =
        parents[index] === -1
          ? local
          : multiply(resolve(parents[index]), local);
    }
    return world[index];
  };
  nodes.forEach((_, index) => resolve(index));
  return world;
}

function matches(names, node, mesh) {
  if (!names) {
    return true;
  }
  const wanted = (name) =>
    name !== undefined &&
    (typeof names === 'function' ? names(name) : names.includes(name));
  return wanted(node.name) || wanted(mesh.name);
}

function triangles(mesh) {
  return mesh.primitives.filter(
    (primitive) =>
      (primitive.mode ?? TRIANGLES) === TRIANGLES &&
      primitive.attributes.POSITION !== undefined
  );
}

/**
 * Accessors that gltfMeshes() reads for the selected nodes.
 * @param {object} json
 * @param {{names?: string[]|((name: string) => boolean)}} [options]
 */
export function meshAccessors(json, options = {}) {
  const used = new Set();
  for (const node of json.nodes ?? []) {
    const mesh = json.meshes?.[node.mesh];
    if (mesh && matches(options.names, node, mesh)) {
      for (const primitive of triangles(mesh)) {
        used.add(primitive.attributes.POSITION);
        if (primitive.indices !== undefined) {
          used.add(primitive.indices);
        }
      }
    }
  }
  return [...used].sort((a, b) => a - b);
}

/**
 * Triangle meshes of the nodes, in world coordinates times `scale`. The
 * triangle primitives of a node's mesh are merged into one mesh named
 * after the node (or, without a node name, the mesh).
 * @param {object} json
 * @param {(accessor: number) => ArrayLike<number>} read
 * @param {{names?: string[]|((name: string) => boolean), scale?: number}} [options]
 * @returns {{name: string, positions: Float64Array, indices: Uint32Array}[]}
 */
export function gltfMeshes(json, read, options = {}) {
  const scale = options.scale ?? 1;
  const world = worldMatrices(json);
  const meshes = [];
  (json.nodes ?? []).forEach((node, nodeIndex) => {
    const mesh = json.meshes?.[node.mesh];
    if (!mesh || !matches(options.names, node, mesh)) {
      return;
    }
    const m = world[nodeIndex] ?? IDENTITY;
    const parts = triangles(mesh).map((primitive) => {
      const local = read(primitive.attributes.POSITION);
      const count = local.length / 3;
      return {
        local,
        indices:
          primitive.indices === undefined
            ? Uint32Array.from({ length: count }, (_, index) => index)
            : read(primitive.indices),
      };
    });
    const vertexCount = parts.reduce((sum, part) => sum + part.local.length, 0);
    const indexCount = parts.reduce(
      (sum, part) => sum + part.indices.length,
      0
    );
    const positions = new Float64Array(vertexCount);
    const indices = new Uint32Array(indexCount);
    let vertex = 0;
    let index = 0;
    for (const part of parts) {
      const base = vertex / 3;
      for (let at = 0; at < part.local.length; at += 3) {
        const [x, y, z] = [
          part.local[at],
          part.local[at + 1],
          part.local[at + 2],
        ];
        for (let axis = 0; axis < 3; axis++) {
          positions[vertex++] =
            scale *
            (m[axis] * x + m[4 + axis] * y + m[8 + axis] * z + m[12 + axis]);
        }
      }
      for (const corner of part.indices) {
        indices[index++] = base + corner;
      }
    }
    meshes.push({ name: node.name ?? mesh.name, positions, indices });
  });
  return meshes;
}

/**
 * Triangle meshes of a whole GLB file (see gltfMeshes).
 * @param {Uint8Array} bytes
 * @param {{names?: string[]|((name: string) => boolean), scale?: number}} [options]
 */
export function readGlbMeshes(bytes, options = {}) {
  const { json, binOffset } = glbJson(bytes);
  const data = bytes.subarray(binOffset);
  return gltfMeshes(
    json,
    (accessor) => readAccessor(json, accessor, data),
    options
  );
}

/** Byte ranges closer than this are fetched in one request. */
const RANGE_GAP = 1 << 16;

/**
 * Byte ranges of the binary chunk that the accessors need, with ranges
 * that lie close together merged.
 * @param {object} json
 * @param {number[]} accessors
 * @param {number} [gap]
 * @returns {{start: number, end: number}[]}
 */
export function mergedRanges(json, accessors, gap = RANGE_GAP) {
  const ranges = accessors
    .map((index) => accessorRange(json, index))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start - last.end <= gap) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

async function fetchBytes(url, start, end, fetchFn) {
  const response = await fetchFn(url, {
    headers: { Range: `bytes=${start}-${end - 1}` },
  });
  if (response.status !== 206) {
    throw new Error(`${url}: range request answered ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== end - start) {
    throw new Error(`${url}: range ${start}-${end} gave ${bytes.length} bytes`);
  }
  return bytes;
}

/**
 * Triangle meshes of the selected nodes of a remote GLB, fetched with HTTP
 * range requests: the header, the JSON chunk and then only the bytes the
 * selected accessors read (see gltfMeshes for the options).
 * @param {string} url
 * @param {{names?: string[]|((name: string) => boolean), scale?: number,
 *   fetchFn?: typeof fetch}} [options]
 */
export async function fetchGlbMeshes(url, options = {}) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const header = await fetchBytes(url, 0, GLB_HEADER_BYTES, fetchFn);
  const length = glbJsonLength(header);
  const head = new Uint8Array(GLB_HEADER_BYTES + length);
  head.set(header);
  head.set(
    await fetchBytes(url, GLB_HEADER_BYTES, head.length, fetchFn),
    GLB_HEADER_BYTES
  );
  const { json, binOffset } = glbJson(head);
  const chunks = [];
  for (const { start, end } of mergedRanges(
    json,
    meshAccessors(json, options)
  )) {
    chunks.push({
      start,
      end,
      data: await fetchBytes(url, binOffset + start, binOffset + end, fetchFn),
    });
  }
  const read = (accessor) => {
    const { start, end } = accessorRange(json, accessor);
    const chunk = chunks.find((item) => item.start <= start && end <= item.end);
    return readAccessor(json, accessor, chunk.data, chunk.start);
  };
  return gltfMeshes(json, read, options);
}
