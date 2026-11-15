// Kernel parity probe (issue 23): the Rust kernel (scalar build and simd
// build) against the JavaScript step loop of Fdtd3d, 2000 steps, both forms.
//   node experiments/issue-23-kernel-parity.mjs <scalar.wasm> [simd.wasm]
import { readFileSync } from 'node:fs';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const STEPS = Number(process.env.STEPS ?? 2000);
const reference = () => {
  const solver = new Fdtd3d({ model: buildVoxelModel(DEFAULT_HEAD, { dx: 1 }), kernel: 'js' });
  if (!process.env.RAW) {
    // The constructor's coefficients are not stable (conductance 1 next to
    // sinus cells of fill 1/12); a shape sets the real ones.
    const shape = tractShape({ phoneme: getPhoneme('a') }, DEFAULT_HEAD);
    solver.setNose(noseShape(DEFAULT_HEAD).areas);
    solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  }
  return solver;
};

for (const file of process.argv.slice(2)) {
  const { instance } = await WebAssembly.instantiate(readFileSync(file), {});
  const e = instance.exports;
  for (const gather of [0, 1]) {
    const js = reference();
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
    js.pressure[0] = 1;
    view(6, Float64Array, cells)[0] = 1;
    let started = performance.now();
    for (let step = 0; step < STEPS; step++) js.step(0, 0, 0);
    const jsTime = performance.now() - started;
    started = performance.now();
    if (e.vs_fdtd_kernel_steps(handle, STEPS, gather) !== 0) throw new Error('steps');
    const rustTime = performance.now() - started;
    const pressure = view(6, Float64Array, cells);
    const velocity = view(2, Float64Array, links);
    if (process.env.DEBUG) console.log(pressure.slice(0, 5), js.pressure.slice(0, 5), velocity.slice(0, 5));
    let mismatches = 0;
    for (let i = 0; i < cells; i++) if (!(pressure[i] === js.pressure[i] && Number.isFinite(pressure[i]))) mismatches++;
    for (let i = 0; i < links; i++) if (!(velocity[i] === js.velocity[i])) mismatches++;
    console.log(file, { gather, cells, links, mismatches, jsMs: jsTime.toFixed(1), rustMs: rustTime.toFixed(1) });
    e.vs_fdtd_kernel_free(handle);
  }
}
