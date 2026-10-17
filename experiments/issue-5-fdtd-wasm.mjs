// Fdtd3d step speed and bit identity: wasm kernel vs JavaScript loop.
// Usage: node experiments/issue-5-fdtd-wasm.mjs [dx] [steps]
import { buildVoxelModel, DEFAULT_HEAD, Fdtd3d } from '../src/index.js';

const dx = Number(process.argv[2] ?? 1);
const steps = Number(process.argv[3] ?? 30000);
const model = buildVoxelModel(DEFAULT_HEAD, { dx });
const solvers = {
  js: new Fdtd3d({ model, kernel: 'js' }),
  wasm: new Fdtd3d({ model }),
};
const areas = new Float64Array(44).fill(2);
for (const solver of Object.values(solvers)) {
  solver.setShape(areas, 0.3);
}
const best = { js: Infinity, wasm: Infinity };
let identical = true;
for (let round = 0; round < 6; round++) {
  const outputs = {};
  for (const [name, solver] of Object.entries(solvers)) {
    const output = new Float64Array(steps);
    const began = globalThis.performance.now();
    for (let n = 0; n < steps; n++) {
      output[n] = solver.step(Math.sin(n * 0.01), 20, 0);
    }
    best[name] = Math.min(best[name], globalThis.performance.now() - began);
    outputs[name] = output;
  }
  identical &&= outputs.js.every((value, n) =>
    Object.is(value, outputs.wasm[n])
  );
}
console.log({
  dx,
  cells: model.cells.length,
  links: model.links.a.length,
  wasmAvailable: Boolean(solvers.wasm.kernel),
  identical,
  jsMs: +best.js.toFixed(1),
  wasmMs: +best.wasm.toFixed(1),
  speedup: +(best.js / best.wasm).toFixed(2),
});
