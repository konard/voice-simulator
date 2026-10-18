// Share of the wasm kernel in one solver step, per cell size.
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const head = normalizeHeadConfig({});
const now = () => globalThis.performance.now();
for (const dx of process.argv.slice(2).map(Number)) {
  const model = buildVoxelModel(head, { dx });
  const solver = new Fdtd3d({ head, model });
  const shape = tractShape(vowelTarget({ phoneme: getPhoneme('a') }), head);
  solver.setShape(shape.areas, 0, shape.velumIndex, { gap: 1 });
  const steps = Math.round(0.05 / solver.dt);
  let t = now();
  for (let i = 0; i < steps; i++) {
    solver.step(i === 0 ? 1 : 0, 0, 0);
  }
  const full = now() - t;
  t = now();
  for (let i = 0; i < steps; i++) {
    solver.kernel.step();
  }
  const kernel = now() - t;
  const updates = steps * (solver.linkCount + solver.cellCount);
  console.log(
    `dx ${dx}: step ${full.toFixed(0)} ms, kernel ${kernel.toFixed(0)} ms, ${((kernel * 1e6) / updates).toFixed(2)} ns per update`
  );
}
