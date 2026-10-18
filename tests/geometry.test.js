/**
 * Head geometry: tract placement, low-poly meshes and OBJ export.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  arcPoint,
  headLandmarks,
  nasalCenterline,
  tractCenterline,
} from '../src/geometry/centerline.js';
import {
  MESH_LODS,
  deformJaw,
  headField,
  headMesh,
  meshesToObj,
  sectionAxes,
  tractAxes,
  tubeMesh,
} from '../src/geometry/mesh.js';
import { lipsMesh } from '../src/geometry/lips.js';
import { noseShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';

function pathLength(path) {
  const { points, count, sectionLength } = path;
  let length = sectionLength;
  for (let index = 1; index < count; index++) {
    length += Math.hypot(
      points[index * 3] - points[index * 3 - 3],
      points[index * 3 + 1] - points[index * 3 - 2],
      points[index * 3 + 2] - points[index * 3 - 1]
    );
  }
  return length;
}

describe('tract centreline', () => {
  it('is as long as the vocal tract and ends at the lips', () => {
    for (const vocalTractLength of [14, 16.5, 19]) {
      const head = normalizeHeadConfig({ ...DEFAULT_HEAD, vocalTractLength });
      const path = tractCenterline(head, { sections: 88 });
      expect(Math.abs(pathLength(path) - vocalTractLength)).toBeLessThan(0.05);
      const { lips } = headLandmarks(head);
      const end = arcPoint(vocalTractLength, path.layout).point;
      expect(
        Math.hypot(...end.map((value, axis) => value - lips[axis]))
      ).toBeLessThan(1e-9);
      // The last section centre lies half a section back along the tract.
      const last = path.points.subarray(87 * 3);
      const back = Math.hypot(...lips.map((value, axis) => value - last[axis]));
      expect(Math.abs(back - path.sectionLength / 2)).toBeLessThan(0.01);
      expect(lips[2] - last[2]).toBeGreaterThan(0);
    }
  });

  it('bends like the MRI tracts: up from the glottis, forward and down to the lips', () => {
    const path = tractCenterline(DEFAULT_HEAD, { sections: 88 });
    const tangent = (index) => path.tangents.subarray(index * 3, index * 3 + 3);
    expect(tangent(0)[1]).toBeGreaterThan(0.999);
    const end = tangent(path.count - 1);
    expect(end[0]).toBe(0);
    expect(end[2]).toBeGreaterThan(0.85);
    expect(end[1]).toBeLessThan(0);
    // The oral cavity runs forward under the palate.
    const forward = Array.from({ length: path.count }, (_, index) =>
      tangent(index)
    ).some((value) => value[2] > 0.999);
    expect(forward).toBe(true);
  });

  it('nasal path matches the acoustic nose length', () => {
    const nose = noseShape(DEFAULT_HEAD);
    const path = nasalCenterline(DEFAULT_HEAD, {
      velumDistance: DEFAULT_HEAD.vocalTractLength * 0.45,
      length: nose.length,
    });
    expect(Math.abs(path.length - nose.length)).toBeLessThan(0.1);
    const end = path.points.subarray((path.count - 1) * 3);
    expect(end[1]).toBeGreaterThan(headLandmarks(DEFAULT_HEAD).lips[1]);
  });
});

describe('head meshes', () => {
  it('head field is negative inside and positive outside', () => {
    const field = headField(DEFAULT_HEAD);
    expect(field([0, -2, 2])).toBeLessThan(0);
    expect(field([0, 0, 30])).toBeGreaterThan(0);
    expect(field([30, 0, 0])).toBeGreaterThan(0);
  });

  it('each LOD has more vertices than the previous one', () => {
    let previous = 0;
    for (let lod = 0; lod < MESH_LODS.length; lod++) {
      const mesh = headMesh(DEFAULT_HEAD, { lod });
      const vertices = mesh.positions.length / 3;
      expect(vertices).toBeGreaterThan(previous);
      expect(Math.max(...mesh.indices)).toBeLessThan(vertices);
      previous = vertices;
    }
  });

  it('section axes keep the cross-sectional area', () => {
    for (const position of [0.1, 0.5, 0.95, 1]) {
      for (const area of [0.3, 1, 4]) {
        const [major, minor] = sectionAxes(area, position, DEFAULT_HEAD);
        expect(Math.abs(Math.PI * major * minor - area) / area).toBeLessThan(
          0.01
        );
        expect(major).toBeGreaterThan(minor - 1e-9);
      }
    }
  });

  it('tract axes keep the palate side of a section at rest', () => {
    const rest = new Float64Array(44).fill(3);
    const axes = tractAxes(DEFAULT_HEAD, rest);
    for (const position of [0.3, 0.6, 0.8]) {
      for (const area of [0.3, 1, 6]) {
        const [major, minor, shift] = axes(area, position);
        const [, restMinor] = sectionAxes(3, position, DEFAULT_HEAD);
        expect(Math.abs(Math.PI * major * minor - area) / area).toBeLessThan(
          0.01
        );
        // The upper wall (centre + shift + minor) stays where it is at rest.
        expect(Math.abs(shift + minor - restMinor)).toBeLessThan(1e-9);
      }
    }
    // The shift fades out at the glottis and at the lips.
    expect(axes(0.3, 0)[2]).toBe(0);
    expect(axes(0.3, 1)[2]).toBe(0);
  });

  it('tube mesh follows the area function', () => {
    const path = tractCenterline(DEFAULT_HEAD, { sections: 8 });
    const narrow = tubeMesh(path, new Float64Array(8).fill(0.5));
    const wide = tubeMesh(path, new Float64Array(8).fill(4));
    const spread = (mesh) => {
      let max = 0;
      for (let index = 0; index < mesh.ring * 3; index += 3) {
        max = Math.max(max, Math.abs(mesh.positions[index]));
      }
      return max;
    };
    expect(spread(wide)).toBeGreaterThan(spread(narrow) * 2);
  });

  it('opening the jaw lowers the chin but not the cranium', () => {
    const mesh = headMesh(DEFAULT_HEAD, { lod: 1 });
    const open = deformJaw(
      mesh.positions,
      new Float32Array(mesh.positions.length),
      DEFAULT_HEAD,
      1
    );
    let chinMoved = 0;
    let topMoved = 0;
    for (let index = 0; index < open.length; index += 3) {
      const dy = open[index + 1] - mesh.positions[index + 1];
      if (mesh.positions[index + 1] > 2) {
        topMoved = Math.max(topMoved, Math.abs(dy));
      } else {
        chinMoved = Math.min(chinMoved, dy);
      }
    }
    expect(topMoved).toBe(0);
    expect(chinMoved).toBeLessThan(-0.5);
  });

  it('exports OBJ with objects, vertices and faces', () => {
    const lips = lipsMesh(DEFAULT_HEAD, { area: 1 });
    const text = meshesToObj([{ name: 'lips', ...lips }]);
    const lines = text.split('\n');
    expect(lines).toContain('o lips');
    const vertices = lines.filter((line) => line.startsWith('v ')).length;
    const faces = lines.filter((line) => line.startsWith('f ')).length;
    expect(vertices).toBe(lips.positions.length / 3);
    expect(faces).toBe(lips.indices.length / 3);
  });
});
