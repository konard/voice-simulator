/**
 * Issue 23: time the gather kernel of several engine builds against the
 * hand-written JavaScript WebAssembly kernel on one grid, interleaved
 * round by round so that load on a shared machine hits every build alike.
 * Prints the least time of ROUNDS rounds per build and its ratio to the
 * JavaScript kernel.
 *
 *   node experiments/issue-23-kernel-speed.mjs a.wasm [b.wasm ...]
 *
 * DX=<cm> (default 0.5), STEPS=<n> (default 2000), ROUNDS=<n> (default 9),
 * FORM=<0|1|2> picks the kernel form of vs_fdtd_kernel_steps: 0 scatter with
 * flux, 1 gather (default), 2 Grid::step (scatter without flux, the solver's).
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
const ROUNDS = Number(process.env.ROUNDS ?? 9);
const FORM = Number(process.env.FORM ?? 1);
const files = process.argv.slice(2);
const { renderOptions } = prepareUtterance('Hello.', { tier: 'high', seed: 1 });
const options = { ...renderOptions, dx: Number(process.env.DX ?? 0.5) };
const model = buildVoxelModel(DEFAULT_HEAD, voxelModelOptions(options));
const make = (kernel) => {
  const solver = new Fdtd3d({ model, kernel, head: DEFAULT_HEAD });
  const shape = tractShape({ phoneme: getPhoneme('a') }, DEFAULT_HEAD);
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  solver.pressure[0] = 1;
  return solver;
};
const reference = make('js');
const links = reference.linkCount;
const cells = reference.cellCount;

/** A Rust kernel of `file` with the coefficients of the reference. */
async function rustKernel(file) {
  const { instance } = await globalThis.WebAssembly.instantiate(
    readFileSync(file),
    {}
  );
  const e = instance.exports;
  const handle = e.vs_fdtd_kernel_new(links, cells);
  const view = (which, Type, count) =>
    new Type(e.memory.buffer, e.vs_fdtd_kernel_array(handle, which), count);
  view(0, Uint32Array, links).set(reference.linkA);
  view(1, Uint32Array, links).set(reference.linkB);
  view(3, Float64Array, links).set(reference.damping);
  view(4, Float64Array, links).set(reference.conductance);
  view(8, Float64Array, cells).set(reference.keep);
  view(9, Float64Array, cells).set(reference.gain);
  view(6, Float64Array, cells)[0] = 1;
  e.vs_fdtd_kernel_steps(handle, 1, FORM);
  return () => e.vs_fdtd_kernel_steps(handle, STEPS, FORM);
}

const javascript = make('wasm');
const runs = [
  [
    'js kernel wasm',
    () => {
      for (let step = 0; step < STEPS; step++) {
        javascript.step(0, 0, 0);
      }
    },
  ],
];
for (const file of files) {
  runs.push([file, await rustKernel(file)]);
}
const best = runs.map(() => Infinity);
for (let round = 0; round < ROUNDS; round++) {
  runs.forEach(([, run], index) => {
    const started = globalThis.performance.now();
    run();
    best[index] = Math.min(best[index], globalThis.performance.now() - started);
  });
}
console.log(
  `dx ${options.dx}: ${cells} cells, ${links} links, ${STEPS} steps, least of ${ROUNDS} rounds`
);
runs.forEach(([name], index) => {
  console.log(
    `${name}: ${best[index].toFixed(1)} ms, ${(best[index] / best[0]).toFixed(2)}x javascript`
  );
});
