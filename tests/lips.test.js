/**
 * Lips: two closed lofts whose free edges outline the acoustic lip
 * opening, in front of the incisors, rounded and pushed forward by lip
 * rounding.
 */

import { describe, it, expect } from 'test-anywhere';
import { vowelTarget } from '../src/articulation/phones.js';
import { headLandmarks } from '../src/geometry/centerline.js';
import { LIP_LODS, lipOpening, lipsMesh } from '../src/geometry/lips.js';
import { headMesh } from '../src/geometry/mesh.js';
import { headModel } from '../src/geometry/model.js';
import {
  DEFAULT_HEAD,
  presetHeadConfig,
  randomHeadConfig,
} from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const LOD = 2;

function vowel(symbol) {
  return vowelTarget({ phoneme: getPhoneme(symbol) });
}

/** Vertex of one lip (0 upper, 1 lower) at a column and ring step. */
function lipVertex(mesh, lip, column, step) {
  const { columns, ring } = LIP_LODS[LOD];
  const perLip = columns * ring + 2;
  const index = (lip * perLip + column * ring + step) * 3;
  return Array.from(mesh.positions.subarray(index, index + 3));
}

function extent(positions, axis, keep = () => true) {
  let low = Infinity;
  let high = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    const point = positions.subarray(index, index + 3);
    if (keep(point)) {
      low = Math.min(low, point[axis]);
      high = Math.max(high, point[axis]);
    }
  }
  return [low, high];
}

/** Signed volume of a closed mesh: positive when faces point outward. */
function signedVolume({ positions, indices }) {
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) =>
      positions.subarray(indices[i + k] * 3, indices[i + k] * 3 + 3)
    );
    volume +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return volume / 6;
}

/**
 * Smallest forward distance (cm) of the lips in front of tooth vertices
 * at about the same height and side.
 */
function clearance(lips, teeth) {
  let smallest = Infinity;
  for (let i = 0; i < lips.length; i += 3) {
    for (let j = 0; j < teeth.length; j += 3) {
      const near =
        Math.abs(teeth[j] - lips[i]) < 0.3 &&
        Math.abs(teeth[j + 1] - lips[i + 1]) < 0.2;
      smallest = near
        ? Math.min(smallest, lips[i + 2] - teeth[j + 2])
        : smallest;
    }
  }
  return smallest;
}

describe('lips', () => {
  it('keeps the vertex count for any opening and adds detail per LOD', () => {
    const counts = LIP_LODS.map((_, lod) => {
      const sizes = [
        [0, 0],
        [1, 0],
        [6, 0],
        [0.3, 1],
      ].map(([area, rounding]) => {
        const mesh = lipsMesh(DEFAULT_HEAD, { area, rounding, lod });
        expect(mesh.positions.every(Number.isFinite)).toBe(true);
        expect(Math.max(...mesh.indices)).toBeLessThan(
          mesh.positions.length / 3
        );
        expect(signedVolume(mesh)).toBeGreaterThan(1);
        return mesh.positions.length;
      });
      expect(new Set(sizes).size).toBe(1);
      return sizes[0];
    });
    for (let lod = 1; lod < counts.length; lod++) {
      expect(counts[lod]).toBeGreaterThan(counts[lod - 1]);
    }
  });

  it('outlines the acoustic opening with the free edges', () => {
    for (const head of [DEFAULT_HEAD, randomHeadConfig(5)]) {
      for (const [area, rounding] of [
        [0.4, 0],
        [2, 0],
        [6, 0],
        [0.5, 1],
      ]) {
        const mesh = lipsMesh(head, { area, rounding, lod: LOD });
        const [major, minor] = lipOpening(area, rounding, head);
        expect(Math.abs(Math.PI * major * minor - area)).toBeLessThan(1e-9);
        const middle = (LIP_LODS[LOD].columns - 1) / 2;
        const upper = lipVertex(mesh, 0, middle, 0);
        const lower = lipVertex(mesh, 1, middle, 0);
        const height = Math.hypot(...upper.map((v, axis) => v - lower[axis]));
        expect(Math.abs(height - 2 * minor)).toBeLessThan(1e-4);
        // The lower lip, carried by the jaw, moves further than the upper.
        const { lips: centre } = headLandmarks(head);
        expect(centre[1] - lower[1]).toBeGreaterThan(upper[1] - centre[1]);
        // The corners of both lips meet outside the opening.
        const last = LIP_LODS[LOD].columns - 1;
        for (const column of [0, last]) {
          const a = lipVertex(mesh, 0, column, 0);
          const b = lipVertex(mesh, 1, column, 0);
          expect(Math.hypot(...a.map((v, axis) => v - b[axis]))).toBeLessThan(
            1e-4
          );
          expect(Math.abs(a[0])).toBeGreaterThan(major);
        }
      }
    }
  });

  it('closes the mouth at zero area and opens it with the area', () => {
    const middle = (LIP_LODS[LOD].columns - 1) / 2;
    const gap = (area) => {
      const mesh = lipsMesh(DEFAULT_HEAD, { area, lod: LOD });
      return (
        lipVertex(mesh, 0, middle, 0)[1] - lipVertex(mesh, 1, middle, 0)[1]
      );
    };
    expect(gap(0)).toBeLessThan(0.01);
    expect(gap(1)).toBeGreaterThan(gap(0.2));
    expect(gap(6)).toBeGreaterThan(gap(1) + 0.5);
  });

  it('narrows and pushes the lips forward when rounded', () => {
    const [spread, rounded] = [0, 1].map((rounding) =>
      lipsMesh(DEFAULT_HEAD, { area: 0.5, rounding, lod: LOD })
    );
    const width = (mesh) => extent(mesh.positions, 0)[1];
    const front = (mesh) => extent(mesh.positions, 2)[1];
    expect(width(rounded)).toBeLessThan(width(spread) - 0.5);
    expect(front(rounded)).toBeGreaterThan(front(spread) + 0.3);
    const [major, minor] = lipOpening(0.5, 1, DEFAULT_HEAD);
    expect(major / minor).toBeLessThan(1.5);
  });

  it('sits in front of the teeth and stands out of the face', () => {
    const states = [{}, ...['i', 'ɑ', 'u'].map(vowel)];
    for (const head of [DEFAULT_HEAD, presetHeadConfig('female')]) {
      for (const state of states) {
        const meshes = headModel(head, { lod: LOD, state });
        const lips = meshes.find((mesh) => mesh.name === 'lips');
        for (const tooth of meshes.filter((mesh) =>
          mesh.name.endsWith('Teeth')
        )) {
          expect(clearance(lips.positions, tooth.positions)).toBeGreaterThan(
            0.1
          );
        }
      }
      const lips = lipsMesh(head, { area: 1, lod: LOD });
      const { lips: centre } = headLandmarks(head);
      const midline = (point) => Math.abs(point[0]) < 0.5;
      const front = extent(lips.positions, 2, midline)[1];
      const skin = extent(
        headMesh(head, { lod: LOD }).positions,
        2,
        (point) => midline(point) && Math.abs(point[1] - centre[1]) < 0.5
      )[1];
      expect(front).toBeGreaterThan(skin);
      // Corners tuck back into the cheeks.
      const corner = lipVertex(lips, 0, 0, 0);
      expect(corner[2]).toBeLessThan(front - 0.8);
    }
  });
});
