/**
 * Issue 23: time a bare Rust scatter loop (a stand-alone crate, path in
 * argv[2]) against the hand-written kernel of fdtd-kernel.js on the grid
 * of DX (default 0.5), to separate code generation from the solver.
 * Prints the least time of ROUNDS rounds per variant.
 */
import { readFileSync } from 'node:fs';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { createKernel } from '../src/acoustics/fdtd-kernel.js';
import {
  buildVoxelModel,
  voxelModelOptions,
} from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { prepareUtterance } from '../src/synthesize.js';

const STEPS = Number(process.env.STEPS ?? 2000);
const ROUNDS = Number(process.env.ROUNDS ?? 9);
const VARIANTS = (process.env.VARIANTS ?? '0,1').split(',').map(Number);
const { renderOptions } = prepareUtterance('Hello.', { tier: 'high', seed: 1 });
const options = { ...renderOptions, dx: Number(process.env.DX ?? 0.5) };
const model = buildVoxelModel(DEFAULT_HEAD, voxelModelOptions(options));
const s = new Fdtd3d({ model, kernel: 'js', head: DEFAULT_HEAD });
const shape = tractShape({ phoneme: getPhoneme('a') }, DEFAULT_HEAD);
s.setNose(noseShape(DEFAULT_HEAD).areas);
s.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
const links = s.linkCount,
  cells = s.cellCount;
const k = createKernel(links, cells);
k.arrays.linkA.set(s.linkA.map((x) => x * 8));
k.arrays.linkB.set(s.linkB.map((x) => x * 8));
k.arrays.damping.set(s.damping);
k.arrays.conductance.set(s.conductance);
k.arrays.keep.set(s.keep);
k.arrays.gain.set(s.gain);
k.arrays.pressure[0] = 1;
const { instance } = await globalThis.WebAssembly.instantiate(
  readFileSync(process.argv[2]),
  {}
);
const e = instance.exports;
e.init(links, cells);
const v = (w, T, n) => new T(e.memory.buffer, e.arr(w), n);
v(0, Uint32Array, links).set(s.linkA);
v(1, Uint32Array, links).set(s.linkB);
v(3, Float64Array, links).set(s.damping);
v(4, Float64Array, links).set(s.conductance);
v(7, Float64Array, cells).set(s.keep);
v(8, Float64Array, cells).set(s.gain);
v(5, Float64Array, cells)[0] = 1;
const runs = [
  [
    'wat',
    () => {
      for (let i = 0; i < STEPS; i++) {
        k.step();
      }
    },
  ],
];
for (const variant of VARIANTS) {
  runs.push([`rust ${variant}`, () => e.scatter(STEPS, variant)]);
}
const best = runs.map(() => Infinity);
for (let r = 0; r < ROUNDS; r++) {
  runs.forEach(([, run], i) => {
    const t = globalThis.performance.now();
    run();
    best[i] = Math.min(best[i], globalThis.performance.now() - t);
  });
}
console.log(`dx ${options.dx}: ${cells} cells, ${links} links`);
runs.forEach(([n], i) =>
  console.log(
    `${n}: ${best[i].toFixed(1)} ms, ${(best[i] / best[0]).toFixed(2)}x`
  )
);
