/** Bounded scalar-kernel probe: 8,000 cells, 22,800 links, five timed runs. */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createKernel } from '../src/acoustics/fdtd-kernel.js';
import { loadEngineModule } from '../src/engine/wasm-loader.js';

const side = 20;
const cells = side ** 3;
const a = [];
const b = [];
for (let z = 0; z < side; z++) {
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const here = x + side * (y + side * z);
      for (const [coordinate, stride] of [
        [x, 1],
        [y, side],
        [z, side ** 2],
      ]) {
        if (coordinate + 1 < side) {
          a.push(here);
          b.push(here + stride);
        }
      }
    }
  }
}
const js = createKernel(a.length, cells);
js.arrays.linkA.set(a.map((index) => 8 * index));
js.arrays.linkB.set(b.map((index) => 8 * index));
js.arrays.damping.fill(1);
js.arrays.conductance.fill(1);
js.arrays.keep.fill(1);
js.arrays.gain.fill(0.5);
js.arrays.pressure[0] = 1;
const steps = 1000;
const variants = [
  {
    name: 'js',
    step() {
      for (let step = 0; step < steps; step++) {
        js.step();
      }
    },
  },
];
const files = process.argv.slice(2);
if (files.length > 3) {
  throw new Error('Compare at most three scalar builds');
}
for (const file of files.length ? files : [undefined]) {
  const engine = await loadEngineModule(
    file ? pathToFileURL(file) : undefined,
    { simd: false }
  );
  if (!engine) {
    throw new Error('Build the scalar WASM engine first');
  }
  const handle = engine.exports.vs_fdtd_kernel_new(a.length, cells);
  const view = (which, Type, length) =>
    new Type(
      engine.memory.buffer,
      engine.exports.vs_fdtd_kernel_array(handle, which),
      length
    );
  view(0, Uint32Array, a.length).set(a);
  view(1, Uint32Array, b.length).set(b);
  view(6, Float64Array, cells)[0] = 1;
  variants.push({
    name: file ?? 'rust',
    step() {
      if (engine.exports.vs_fdtd_kernel_steps(handle, steps, 2) !== 0) {
        throw new Error('Kernel step failed');
      }
    },
    pressure: () => view(6, Float64Array, cells),
    free: () => engine.exports.vs_fdtd_kernel_free(handle),
  });
}
const times = Object.fromEntries(variants.map(({ name }) => [name, []]));
try {
  // Finish WebAssembly tier-up before comparing optimized scalar loops.
  for (let warm = 0; warm < 10; warm++) {
    for (const variant of variants) {
      variant.step();
    }
  }
  for (let run = 0; run < 6; run++) {
    for (const variant of variants) {
      const start = performance.now();
      variant.step();
      if (run > 0) {
        times[variant.name].push(performance.now() - start);
      }
    }
  }
  for (const variant of variants.slice(1)) {
    if (
      !variant
        .pressure()
        .every(
          (value, i) =>
            Number.isFinite(value) && value === js.arrays.pressure[i]
        )
    ) {
      throw new Error(`Scalar kernels differ: ${variant.name}`);
    }
  }
  console.log(
    JSON.stringify({ cells, links: a.length, steps, milliseconds: times })
  );
} finally {
  for (const variant of variants) {
    variant.free?.();
  }
}
