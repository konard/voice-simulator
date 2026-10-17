// Per-frame CPU cost of the articulator meshes the viewer rebuilds (tongue
// every frame, lower teeth and velum when the jaw or velum moves) next to
// the tract shape the viewer already computes.
// Usage: node experiments/issue-5-anatomy-frame-cost.mjs
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import {
  lowerTeethMesh,
  tongueMesh,
  velumMesh,
} from '../src/geometry/anatomy.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const FRAMES = 600;
const states = ['i', 'ɑ', 'u', 'e'].map((symbol) =>
  vowelTarget({ phoneme: getPhoneme(symbol) })
);

function time(label, run) {
  const start = globalThis.performance.now();
  for (let frame = 0; frame < FRAMES; frame++) {
    run(frame);
  }
  const ms = (globalThis.performance.now() - start) / FRAMES;
  console.log(`${label.padEnd(36)} ${ms.toFixed(4)} ms/frame`);
}

for (const lod of [0, 3]) {
  time(`lod ${lod} tractShape (existing)`, (frame) =>
    tractShape(states[frame % 4], DEFAULT_HEAD)
  );
  time(`lod ${lod} tongue + lower teeth + velum`, (frame) => {
    const shape = tractShape(states[frame % 4], DEFAULT_HEAD);
    tongueMesh(DEFAULT_HEAD, { lod, shape });
    lowerTeethMesh(DEFAULT_HEAD, { lod, gap: shape.teeth.gap });
    velumMesh(DEFAULT_HEAD, { lod, velum: (frame % 10) / 10 });
  });
}
