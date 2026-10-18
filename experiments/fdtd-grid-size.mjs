// Cells, links and CPU speed of the 3D solver at each grid size.
// Usage: node experiments/fdtd-grid-size.mjs
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

for (const dx of [1, 0.6, 0.5, 0.4]) {
  const solver = new Fdtd3d({ head: DEFAULT_HEAD, dx });
  solver.setShape(new Array(44).fill(3), 0, 0, { gap: 0.4 });
  const steps = 2000;
  const began = globalThis.performance.now();
  for (let step = 0; step < steps; step++) {
    solver.step(step < 20 ? 1 : 0, 30, 0);
  }
  const seconds = (globalThis.performance.now() - began) / 1000;
  const audio = steps * solver.dt;
  console.log(
    `dx ${dx}: ${solver.cellCount} cells, ${solver.linkCount} links, ${Math.round(1 / solver.dt)} steps/s, ${(seconds / audio).toFixed(1)} s per s of audio (wasm)`
  );
}
