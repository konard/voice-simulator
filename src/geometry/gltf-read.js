/**
 * Reader for binary glTF 2.0 (.glb) files written by any tool (Blender,
 * Maya, three.js, the Human Reference Atlas): the triangle meshes of the
 * scene's nodes, in the file's world frame and units. Accessors may share
 * interleaved buffer views with a byte stride and use any component type,
 * and nodes may carry translation, rotation, scale or a matrix.
 *
 * Reading is split so a remote file never has to be downloaded whole: the
 * first 20 bytes give the JSON length, the JSON lists the byte spans of the
 * accessors a set of nodes needs, and only those spans are then read
 * (scripts/fetch-anatomy.mjs does it with HTTP range requests).
 */

const GLB_MAGIC = 0x46546c67;
const TRIANGLES = 4;
const COMPONENT_TYPES = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const TYPE_WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Bytes before the JSON chunk's data: file header and chunk header. */
export const GLB_HEADER_BYTES = 20;

/**
 * Length of the JSON chunk from the first GLB_HEADER_BYTES of a .glb.
 * @param {Uint8Array} bytes
 */
export function glbJsonLength(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new Error('not a glTF 2.0 binary');
  }
  return view.getUint32(12, true);
}

/** File offset of the binary chunk's data for a JSON chunk length. */
export function glbBinaryOffset(jsonLength) {
  return GLB_HEADER_BYTES + jsonLength + 8;
}

/**
 * Where an accessor's elements lie in the binary chunk: the span
 * [start, end) and the layout of its elements.
 * @param {object} json
 * @param {number} index Accessor index.
 */
export function accessorSpan(json, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const Type = COMPONENT_TYPES[accessor.componentType];
  const width = TYPE_WIDTHS[accessor.type];
  if (!Type || !width) {
    throw new Error(`unsupported accessor ${index}`);
  }
  const element = width * Type.BYTES_PER_ELEMENT;
  const stride = view.byteStride ?? element;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return {
    start,
    end: start + stride * (accessor.count - 1) + element,
    stride,
    element,
    width,
    count: accessor.count,
    Type,
  };
}

/**
 * Values of an accessor from the bytes of its span, packed without stride.
 * @param {object} json
 * @param {number} index
 * @param {Uint8Array} bytes accessorSpan(json, index) bytes of the chunk.
 */
export function readAccessor(json, index, bytes) {
  const { stride, element, width, count, Type } = accessorSpan(json, index);
  const packed = new Uint8Array(count * element);
  for (let item = 0; item < count; item++) {
    packed.set(
      bytes.subarray(item * stride, item * stride + element),
      item * element
    );
  }
  return new Type(packed.buffer, 0, count * width);
}

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

/** Column-major local matrix of a node. */
export function nodeMatrix(node) {
  if (node.matrix) {
    return [...node.matrix];
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
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
 * Nodes of the default scene that carry a mesh, with their world matrices
 * and names (the node's, else the mesh's).
 * @param {object} json
 * @param {{names?: string[]}} [options] keep only these names.
 */
export function meshNodes(json, { names } = {}) {
  const found = [];
  const walk = (index, parent) => {
    const node = json.nodes[index];
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const name = node.name ?? json.meshes[node.mesh].name ?? `mesh${index}`;
      if (!names || names.includes(name)) {
        found.push({ name, mesh: node.mesh, matrix });
      }
    }
    (node.children ?? []).forEach((child) => walk(child, matrix));
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? json.nodes.map((_, index) => index);
  roots.forEach((root) => walk(root, IDENTITY));
  return found;
}

function trianglePrimitives(json, node) {
  return json.meshes[node.mesh].primitives.filter(
    (primitive) => (primitive.mode ?? TRIANGLES) === TRIANGLES
  );
}

/**
 * Accessors the triangle meshes of some nodes need (positions and
 * indices), to fetch before gltfMeshes().
 * @param {object} json
 * @param {{names?: string[]}} [options]
 * @returns {number[]}
 */
export function meshAccessors(json, options) {
  const accessors = new Set();
  for (const node of meshNodes(json, options)) {
    for (const primitive of trianglePrimitives(json, node)) {
      accessors.add(primitive.attributes.POSITION);
      if (primitive.indices !== undefined) {
        accessors.add(primitive.indices);
      }
    }
  }
  return [...accessors];
}

function transformed(positions, matrix) {
  const out = new Float32Array(positions.length);
  for (let at = 0; at < positions.length; at += 3) {
    const [x, y, z] = [positions[at], positions[at + 1], positions[at + 2]];
    for (let axis = 0; axis < 3; axis++) {
      out[at + axis] =
        matrix[axis] * x +
        matrix[4 + axis] * y +
        matrix[8 + axis] * z +
        matrix[12 + axis];
    }
  }
  return out;
}

/**
 * Triangle meshes of the scene's nodes in the file's world frame: one per
 * node, its triangle primitives merged.
 * @param {object} json
 * @param {(accessor: number) => Uint8Array} spanBytes bytes of an
 *   accessor's span (see accessorSpan).
 * @param {{names?: string[]}} [options]
 * @returns {{name: string, positions: Float32Array, indices: Uint32Array}[]}
 */
export function gltfMeshes(json, spanBytes, options) {
  return meshNodes(json, options).map((node) => {
    const positions = [];
    const indices = [];
    let base = 0;
    for (const primitive of trianglePrimitives(json, node)) {
      const position = primitive.attributes.POSITION;
      const local = readAccessor(json, position, spanBytes(position));
      const count = local.length / 3;
      const order =
        primitive.indices === undefined
          ? Array.from({ length: count }, (_, index) => index)
          : readAccessor(json, primitive.indices, spanBytes(primitive.indices));
      positions.push(transformed(local, node.matrix));
      indices.push(Uint32Array.from(order, (index) => index + base));
      base += count;
    }
    const join = (arrays, Type) => {
      const out = new Type(
        arrays.reduce((sum, array) => sum + array.length, 0)
      );
      let offset = 0;
      for (const array of arrays) {
        out.set(array, offset);
        offset += array.length;
      }
      return out;
    };
    return {
      name: node.name,
      positions: join(positions, Float32Array),
      indices: join(indices, Uint32Array),
    };
  });
}

/**
 * Triangle meshes of a whole .glb in memory.
 * @param {Uint8Array} bytes
 * @param {{names?: string[]}} [options]
 */
export function readGlb(bytes, options) {
  const jsonLength = glbJsonLength(bytes);
  const json = JSON.parse(
    new globalThis.TextDecoder().decode(
      bytes.subarray(GLB_HEADER_BYTES, GLB_HEADER_BYTES + jsonLength)
    )
  );
  const bin = glbBinaryOffset(jsonLength);
  const spanBytes = (index) => {
    const { start, end } = accessorSpan(json, index);
    return bytes.subarray(bin + start, bin + end);
  };
  return { json, meshes: gltfMeshes(json, spanBytes, options) };
}
