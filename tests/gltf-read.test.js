/**
 * Reading glTF binaries written by other tools: node transforms, accessor
 * offsets inside shared buffer views, interleaved vertices, 16-bit indices
 * and, for remote files, HTTP range requests for only the needed bytes.
 */

import { describe, it, expect } from 'test-anywhere';
import { meshesToGlb } from '../src/geometry/gltf.js';
import {
  accessorRange,
  fetchGlbMeshes,
  glbJson,
  mergedRanges,
  nodeMatrix,
  readGlbMeshes,
  worldMatrices,
} from '../src/geometry/gltf-read.js';

const TRIANGLE = {
  name: 'tongue',
  positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

const align4 = (length) => (length + 3) & ~3;

/** GLB of a JSON document and a binary chunk. */
function glb(json, bin) {
  const text = new globalThis.TextEncoder().encode(JSON.stringify(json));
  const jsonLength = align4(text.length);
  const binLength = align4(bin.length);
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(text, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(bin, 28 + jsonLength);
  return bytes;
}

/**
 * A quad as two triangles, written like exporters do: positions
 * interleaved with normals (stride 24) at an accessor offset of 8 bytes
 * into a shared view, 16-bit indices after them, and a parent node that
 * translates and a child that rotates a quarter turn about z and scales.
 */
function exporterGlb() {
  const bin = new Uint8Array(8 + 4 * 24 + 12);
  const view = new DataView(bin.buffer);
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ];
  corners.forEach((corner, vertex) =>
    corner.forEach((value, axis) =>
      view.setFloat32(8 + vertex * 24 + axis * 4, value, true)
    )
  );
  [0, 1, 2, 0, 2, 3].forEach((index, at) =>
    view.setUint16(8 + 96 + at * 2, index, true)
  );
  const half = Math.SQRT1_2;
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 104, byteStride: 24 },
      { buffer: 0, byteOffset: 104, byteLength: 12 },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 8,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
      },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    meshes: [
      {
        name: 'quad',
        primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
      },
    ],
    nodes: [
      { name: 'root', translation: [10, 0, 0], children: [1] },
      { name: 'part', mesh: 0, rotation: [0, 0, half, half], scale: [2, 2, 2] },
      {
        name: 'other',
        mesh: 0,
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1],
      },
    ],
  };
  return glb(json, bin);
}

/** fetch() that serves byte ranges of `bytes`, counting the requests. */
function rangeServer(bytes) {
  const server = { requests: [] };
  server.fetch = async (url, { headers }) => {
    const [, start, end] =
      headers.Range.match(/bytes=(\d+)-(\d+)/u).map(Number);
    server.requests.push([start, end + 1]);
    return {
      status: 206,
      arrayBuffer: async () => bytes.slice(start, end + 1).buffer,
    };
  };
  return server;
}

const near = (a, b) => Math.abs(a - b) < 1e-6;

describe('glTF reading', () => {
  it('reads the meshes meshesToGlb writes', () => {
    const [mesh] = readGlbMeshes(meshesToGlb([TRIANGLE]), { scale: 100 });
    expect(mesh.name).toBe('tongue');
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
    expect(
      Array.from(mesh.positions).every((v, i) => near(v, TRIANGLE.positions[i]))
    ).toBe(true);
  });

  it('builds node matrices from TRS and parents', () => {
    const half = Math.SQRT1_2;
    const matrix = nodeMatrix({
      rotation: [0, 0, half, half],
      translation: [1, 2, 3],
    });
    // A quarter turn about z sends x to y.
    expect(near(matrix[1], 1) && near(matrix[4], -1)).toBe(true);
    expect(matrix.slice(12, 15)).toEqual([1, 2, 3]);
    const { json } = glbJson(exporterGlb());
    const world = worldMatrices(json);
    expect(near(world[1][12], 10) && near(world[1][1], 2)).toBe(true);
  });

  it('reads interleaved positions, accessor offsets and 16-bit indices', () => {
    const meshes = readGlbMeshes(exporterGlb());
    expect(meshes.map((mesh) => mesh.name)).toEqual(['part', 'other']);
    const [part, other] = meshes;
    expect(Array.from(part.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    // (1, 0, 0) -> rotated to (0, 1, 0), scaled by 2, moved by 10 in x.
    expect(
      [3, 4, 5].map((i) => Math.round(part.positions[i] * 1e9) / 1e9)
    ).toEqual([10, 2, 0]);
    expect([6, 7, 8].map((i) => other.positions[i])).toEqual([1, 1, 5]);
  });

  it('selects nodes by name or test', () => {
    expect(readGlbMeshes(exporterGlb(), { names: ['other'] }).length).toBe(1);
    expect(
      readGlbMeshes(exporterGlb(), { names: (name) => name.startsWith('p') })
        .length
    ).toBe(1);
  });

  it('merges close byte ranges', () => {
    const { json } = glbJson(exporterGlb());
    expect(accessorRange(json, 0)).toEqual({ start: 8, end: 8 + 3 * 24 + 12 });
    expect(mergedRanges(json, [0, 1])).toEqual([{ start: 8, end: 116 }]);
    expect(mergedRanges(json, [0, 1], 0).length).toBe(2);
  });

  it('fetches only the header, the JSON and the needed bytes', async () => {
    const bytes = exporterGlb();
    const server = rangeServer(bytes);
    const meshes = await fetchGlbMeshes('https://example.org/a.glb', {
      names: ['part'],
      fetchFn: server.fetch,
    });
    expect(meshes.length).toBe(1);
    expect(Array.from(meshes[0].positions)).toEqual(
      Array.from(readGlbMeshes(bytes, { names: ['part'] })[0].positions)
    );
    expect(server.requests.length).toBe(3);
    const fetched = server.requests.reduce((sum, [a, b]) => sum + b - a, 0);
    expect(fetched).toBeLessThan(bytes.length);
  });

  it('rejects files that are not glTF 2.0 binaries', () => {
    expect(() => glbJson(new Uint8Array(32))).toThrow();
  });
});
