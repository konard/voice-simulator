// Bounding boxes, triangle counts and landmarks of the articulator meshes.
// Usage: node experiments/issue-5-anatomy-meshes.mjs
import {
  anatomyMeshes,
  incisorEdges,
  jawOpenness,
} from '../src/geometry/anatomy.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

function box(positions) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[index + axis];
      if (!Number.isFinite(value)) {
        throw new Error(`non-finite vertex ${index / 3}`);
      }
      low[axis] = Math.min(low[axis], value);
      high[axis] = Math.max(high[axis], value);
    }
  }
  return [low, high].map((point) => point.map((v) => v.toFixed(2)).join(' '));
}

for (const symbol of ['i', 'ɑ', 'u', 's']) {
  const phoneme = getPhoneme(symbol);
  const state =
    symbol === 's'
      ? { height: 0.9, sibilance: 1, tongueAmount: 0.9 }
      : vowelTarget({ phoneme });
  const shape = tractShape(state, DEFAULT_HEAD);
  const gap = shape.teeth.gap;
  const edges = incisorEdges(gap, DEFAULT_HEAD);
  console.log(
    `/${symbol}/ gap ${gap.toFixed(3)} openness ${jawOpenness(gap, DEFAULT_HEAD).toFixed(3)}`,
    `upper ${edges.upper.map((v) => v.toFixed(2))} lower ${edges.lower.map((v) => v.toFixed(2))}`
  );
  for (const lod of [0, 3]) {
    for (const mesh of anatomyMeshes(DEFAULT_HEAD, { lod, state })) {
      console.log(
        `  lod ${lod} ${mesh.name.padEnd(10)} tris ${String(mesh.indices.length / 3).padStart(5)} box`,
        box(mesh.positions).join(' .. ')
      );
    }
  }
}
