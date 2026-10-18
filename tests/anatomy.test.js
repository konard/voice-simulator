/**
 * Articulator meshes: teeth, tongue, hard and soft palate follow the
 * articulator state and get finer with the level of detail.
 */

import { describe, it, expect } from 'test-anywhere';
import { vowelTarget } from '../src/articulation/phones.js';
import { teethGap } from '../src/articulation/teeth.js';
import { DEFAULT_HEAD, randomHeadConfig } from '../src/head-config.js';
import {
  ANATOMY_LODS,
  anatomyMeshes,
  incisorEdges,
  jawOpenness,
  lowerTeethMesh,
  tongueMesh,
  upperTeethMesh,
  velumMesh,
} from '../src/geometry/anatomy.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { tractCenterline, upperNormal } from '../src/geometry/centerline.js';
import { tractAxes } from '../src/geometry/mesh.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const NAMES = ['upperTeeth', 'lowerTeeth', 'tongue', 'palate', 'velum'];
const SIBILANT = { height: 0.9, sibilance: 1, tongueAmount: 0.9 };

function vowel(symbol) {
  return vowelTarget({ phoneme: getPhoneme(symbol) });
}

/** Extreme of one coordinate over vertices near the midline front. */
function midlineEdge(positions, front, pick) {
  let value = pick === Math.max ? -Infinity : Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    if (Math.abs(positions[index]) < 0.3 && positions[index + 2] > front) {
      value = pick(value, positions[index + 1]);
    }
  }
  return value;
}

/**
 * Smallest normalised elliptical radius of mesh vertices in the rest
 * tract tube (below 1 = inside the airway).
 */
function closestToAirway(head, positions) {
  const rest = tractShape({}, head);
  const path = tractCenterline(head, { sections: 400, length: rest.length });
  const axes = tractAxes(head, rest.areas);
  let closest = Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    const point = positions.subarray(index, index + 3);
    let best = 0;
    let bestDistance = Infinity;
    for (let section = 0; section < path.count; section++) {
      const centre = path.points.subarray(section * 3, section * 3 + 3);
      const distance = Math.hypot(...centre.map((v, axis) => point[axis] - v));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = section;
      }
    }
    const position = (best + 0.5) / path.count;
    const [major, minor, shift] = axes(
      rest.areas[Math.round(position * (rest.areas.length - 1))],
      position
    );
    const centre = path.points.subarray(best * 3, best * 3 + 3);
    const normal = upperNormal(path.tangents.subarray(best * 3, best * 3 + 3));
    const delta = centre.map((v, axis) => point[axis] - v);
    const v = delta[1] * normal[1] + delta[2] * normal[2] - shift;
    closest = Math.min(closest, Math.hypot(delta[0] / major, v / minor));
  }
  return closest;
}

describe('anatomy meshes', () => {
  it('builds valid named meshes for random heads', () => {
    for (const seed of [1, 2, 3]) {
      const head = randomHeadConfig(seed);
      const meshes = anatomyMeshes(head, { lod: seed, state: vowel('ə') });
      expect(meshes.map((mesh) => mesh.name)).toEqual(NAMES);
      for (const mesh of meshes) {
        const vertices = mesh.positions.length / 3;
        expect(mesh.indices.length % 3).toBe(0);
        expect(mesh.positions.every(Number.isFinite)).toBe(true);
        expect(Math.max(...mesh.indices)).toBeLessThan(vertices);
      }
    }
  });

  it('adds triangles with every level of detail', () => {
    const counts = ANATOMY_LODS.map((_, lod) =>
      anatomyMeshes(DEFAULT_HEAD, { lod }).map(
        (mesh) => mesh.indices.length / 3
      )
    );
    for (let lod = 1; lod < counts.length; lod++) {
      counts[lod].forEach((count, part) => {
        expect(count).toBeGreaterThan(counts[lod - 1][part]);
      });
    }
  });

  it('moves the tongue with the vowel', () => {
    const [front, back] = ['i', 'ɑ'].map((symbol) =>
      tongueMesh(DEFAULT_HEAD, { lod: 2, state: vowel(symbol) })
    );
    const oral = (point) => point[2] > 5 && point[2] < 7.5;
    const dorsum = (mesh) => {
      let top = -Infinity;
      for (let index = 0; index < mesh.positions.length; index += 3) {
        const point = mesh.positions.subarray(index, index + 3);
        top = oral(point) ? Math.max(top, point[1]) : top;
      }
      return top;
    };
    const root = (mesh) =>
      Math.min(...mesh.positions.filter((_, i) => i % 3 === 2));
    // /i/ raises the tongue under the palate, /ɑ/ lowers it and pulls the
    // root back into the pharynx.
    expect(dorsum(front)).toBeGreaterThan(dorsum(back) + 0.3);
    expect(root(back)).toBeLessThan(root(front) - 0.3);
  });

  it('opens the lower teeth by the acoustic incisor gap', () => {
    const upper = upperTeethMesh(DEFAULT_HEAD, { lod: 2 });
    const states = [SIBILANT, vowel('i'), vowel('ɑ')];
    const gaps = states.map((state) => teethGap(state, DEFAULT_HEAD));
    const openness = gaps.map((gap) => jawOpenness(gap, DEFAULT_HEAD));
    for (let index = 1; index < gaps.length; index++) {
      expect(gaps[index]).toBeGreaterThan(gaps[index - 1] - 1e-9);
      expect(openness[index]).toBeGreaterThan(openness[index - 1] - 1e-9);
    }
    expect(gaps[2]).toBeGreaterThan(gaps[0] + 0.8);
    for (const gap of gaps) {
      const edges = incisorEdges(gap, DEFAULT_HEAD);
      expect(Math.abs(edges.upper[1] - edges.lower[1] - gap)).toBeLessThan(
        1e-6
      );
      const lower = lowerTeethMesh(DEFAULT_HEAD, { lod: 2, gap });
      const front = edges.lower[2] - 0.4;
      const measured =
        midlineEdge(upper.positions, front, Math.min) -
        midlineEdge(lower.positions, front, Math.max);
      expect(Math.abs(measured - gap)).toBeLessThan(0.1);
    }
  });

  it('vaults the hard palate over the rest airway without entering it', () => {
    for (const head of [DEFAULT_HEAD, randomHeadConfig(4)]) {
      const palate = anatomyMeshes(head, { lod: 2 }).find(
        (mesh) => mesh.name === 'palate'
      );
      expect(closestToAirway(head, palate.positions)).toBeGreaterThan(0.95);
    }
  });

  it('lowers the soft palate to open the nasal port', () => {
    const [raised, lowered] = [0, 1].map((velum) =>
      velumMesh(DEFAULT_HEAD, { lod: 2, velum })
    );
    // The centre of the cap closing the free end of the velum.
    const tip = (mesh) => mesh.positions.at(-2);
    expect(tip(lowered)).toBeLessThan(tip(raised) - 0.4);
    const nasal = anatomyMeshes(DEFAULT_HEAD, {
      lod: 1,
      state: { ...vowel('a'), velum: 1 },
    }).find((mesh) => mesh.name === 'velum');
    const oral = anatomyMeshes(DEFAULT_HEAD, {
      lod: 1,
      state: vowel('a'),
    }).find((mesh) => mesh.name === 'velum');
    expect(nasal.positions).not.toEqual(oral.positions);
  });
});
