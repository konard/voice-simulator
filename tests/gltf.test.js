/**
 * Binary glTF export of the head model: a valid GLB container that reads
 * back to the same meshes in metres, with unit normals and a material per
 * part. The Khronos glTF validator reports no issues on these files (see
 * docs/case-studies/issue-9/blender).
 */

import { describe, it, expect } from 'test-anywhere';
import {
  PART_MATERIALS,
  meshesToGlb,
  parseGlb,
  vertexNormals,
} from '../src/geometry/gltf.js';
import { headModel, headModelGlb } from '../src/geometry/model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const TRIANGLE = {
  name: 'tongue',
  positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

describe('glTF export', () => {
  it('writes a GLB container with aligned chunks', () => {
    const bytes = meshesToGlb([TRIANGLE]);
    const view = new DataView(bytes.buffer);
    expect(new globalThis.TextDecoder().decode(bytes.subarray(0, 4))).toBe(
      'glTF'
    );
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(bytes.length);
    const jsonLength = view.getUint32(12, true);
    expect(jsonLength % 4).toBe(0);
    expect(view.getUint32(20 + jsonLength, true) % 4).toBe(0);
    expect(bytes.length % 4).toBe(0);
  });

  it('reads back the meshes in metres with bounds and materials', () => {
    const { json, meshes } = parseGlb(meshesToGlb([TRIANGLE]));
    expect(Array.from(meshes[0].positions)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    expect(Array.from(meshes[0].indices)).toEqual([0, 1, 2]);
    expect(Array.from(meshes[0].normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(json.accessors[0].min).toEqual([0, 0, 0]);
    expect(json.accessors[0].max).toEqual([1, 1, 0]);
    const [material] = json.materials;
    expect(material.name).toBe('tongue');
    expect(material.pbrMetallicRoughness.roughnessFactor).toBe(
      PART_MATERIALS.tongue.roughness
    );
  });

  it('exports every part of the head with unit normals', () => {
    const source = headModel(DEFAULT_HEAD, { lod: 1 });
    const { json, meshes } = parseGlb(headModelGlb(DEFAULT_HEAD, { lod: 1 }));
    expect(meshes.map((mesh) => mesh.name)).toEqual(
      source.map((mesh) => mesh.name)
    );
    expect(json.nodes.length).toBe(source.length);
    meshes.forEach((mesh, part) => {
      expect(mesh.indices.length).toBe(source[part].indices.length);
      const error = mesh.positions.reduce(
        (worst, value, index) =>
          Math.max(
            worst,
            Math.abs(value - source[part].positions[index] / 100)
          ),
        0
      );
      expect(error).toBeLessThan(1e-6);
      for (let index = 0; index < mesh.normals.length; index += 3) {
        const length = Math.hypot(...mesh.normals.subarray(index, index + 3));
        expect(Math.abs(length - 1)).toBeLessThan(1e-4);
      }
    });
    // The skin is see-through, as in the viewer.
    expect(json.materials[0].alphaMode).toBe('BLEND');
  });

  it('weights normals by triangle area', () => {
    const normals = vertexNormals(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 3],
      [0, 1, 2, 0, 3, 1]
    );
    // Shared corner 0: the xz triangle is three times the xy one.
    const [x, y, z] = normals.subarray(0, 3);
    expect(Math.abs(x)).toBeLessThan(1e-6);
    expect(y).toBeGreaterThan(2.9 * z);
  });
});
