// Cells, links and real-time factor of the 3D solver for several cell sizes.
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const head = normalizeHeadConfig({});
const sizes = process.argv.slice(2).map(Number);
for (const dx of sizes.length ? sizes : [1, 0.6, 0.5, 0.4]) {
  let t = globalThis.performance.now();
  const model = buildVoxelModel(head, { dx });
  const build = (globalThis.performance.now() - t) / 1000;
  const solver = new Fdtd3d({ head, model });
  const shape = tractShape(vowelTarget({ phoneme: getPhoneme('a') }), head);
  solver.setShape(shape.areas, 0, shape.velumIndex, { gap: 1 });
  const steps = Math.round(0.05 / solver.dt);
  t = globalThis.performance.now();
  for (let i = 0; i < steps; i++) {
    solver.step(i === 0 ? 1 : 0, 0, 0);
  }
  const sec = (globalThis.performance.now() - t) / 1000;
  console.log(
    `dx ${dx}: cells ${model.cells.length}, links ${model.links.a.length}, build ${build.toFixed(1)} s, rate ${(1 / solver.dt / 1000).toFixed(0)} kHz, real-time factor ${(sec / 0.05).toFixed(2)}`
  );
}
