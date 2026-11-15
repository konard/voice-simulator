/**
 * Issue 23: why the Rust render with a 40 cm enclosure is slower than
 * JavaScript. Times STEPS steps of the kernel alone on the enclosure grid of
 * tier high: JavaScript (kernel 'wasm' and 'js') and the Rust kernel probe
 * in both forms.
 *
 *   node experiments/issue-23-enclosure-speed.mjs [scalar.wasm]
 *
 * NO_ENCLOSURE=1 times the grid without the enclosure, DX=<cm> another cell
 * size, REPEAT=<n> keeps the least time of n runs.
 */
import { readFileSync } from 'node:fs';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import {
  buildVoxelModel,
  voxelModelOptions,
} from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { prepareUtterance } from '../src/synthesize.js';

const STEPS = Number(process.env.STEPS ?? 2000);
const file = process.argv[2] ?? 'src/engine/voice-simulator.wasm';
const { renderOptions } = prepareUtterance('Hello.', { tier: 'high', seed: 1 });
const enclosure = process.env.NO_ENCLOSURE
  ? undefined
  : { width: 40, height: 40, depth: 40 };
const options = {
  ...renderOptions,
  enclosure,
  ...(process.env.DX ? { dx: Number(process.env.DX) } : {}),
};
const model = buildVoxelModel(DEFAULT_HEAD, voxelModelOptions(options));
const make = (kernel) => {
  const solver = new Fdtd3d({ model, kernel, head: DEFAULT_HEAD });
  const shape = tractShape({ phoneme: getPhoneme('a') }, DEFAULT_HEAD);
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  solver.pressure[0] = 1;
  return solver;
};
const REPEAT = Number(process.env.REPEAT ?? 1);
/** The least time of REPEAT runs of `action` (ms). */
const time = (action) => {
  let best = Infinity;
  for (let run = 0; run < REPEAT; run++) {
    const started = globalThis.performance.now();
    action();
    best = Math.min(best, globalThis.performance.now() - started);
  }
  return best.toFixed(1);
};
for (const kernel of ['wasm', 'js']) {
  const solver = make(kernel);
  console.log(
    `js kernel ${kernel}: cells ${solver.cellCount}, links ${solver.linkCount}, ${time(
      () => {
        for (let step = 0; step < STEPS; step++) {
          solver.step(0, 0, 0);
        }
      }
    )} ms`
  );
}
const { instance } = await globalThis.WebAssembly.instantiate(
  readFileSync(file),
  {}
);
const e = instance.exports;
for (const gather of [0, 1]) {
  const js = make('js');
  const links = js.linkCount;
  const cells = js.cellCount;
  const handle = e.vs_fdtd_kernel_new(links, cells);
  const view = (which, Type, count) =>
    new Type(e.memory.buffer, e.vs_fdtd_kernel_array(handle, which), count);
  view(0, Uint32Array, links).set(js.linkA);
  view(1, Uint32Array, links).set(js.linkB);
  view(3, Float64Array, links).set(js.damping);
  view(4, Float64Array, links).set(js.conductance);
  view(8, Float64Array, cells).set(js.keep);
  view(9, Float64Array, cells).set(js.gain);
  view(6, Float64Array, cells)[0] = 1;
  e.vs_fdtd_kernel_steps(handle, 1, gather);
  console.log(
    `rust kernel gather ${gather}: ${time(() => e.vs_fdtd_kernel_steps(handle, STEPS - 1, gather))} ms`
  );
  e.vs_fdtd_kernel_free(handle);
}
