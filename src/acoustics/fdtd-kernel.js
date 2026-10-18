/**
 * WebAssembly version of the FDTD step loop (source:
 * experiments/wasm/fdtd-kernel.wat, built by experiments/wasm/build.mjs).
 * It runs the same f64 operations in the same order as the JavaScript loop
 * in fdtd3d.js, so the waveform is bit-identical, about 1.8x faster on V8.
 * The solver arrays live in the module's memory; when WebAssembly is not
 * available the solver keeps plain typed arrays and the JavaScript loop.
 */

const WASM =
  'AGFzbQEAAAABDwFgC39/f39/f39/f39/AAMCAQAFAwEAAQcRAgZtZW1vcnkCAARzdGVwAAAKlAIBkQICA38CfCACIABBAnRqIQsCQANAIAIgC08NASACKAIAIQwgAygCACENIAUrAwAgBCsDAEQAAAAAAADgPyAHIA1qKwMAIAcgDGorAwChoqGiIQ4gBCAOOQMAIAYrAwAgDqIhDyAIIAxqIQwgCCANaiENIAwgDCsDACAPoDkDACANIA0rAwAgD6E5AwAgAkEEaiECIANBBGohAyAEQQhqIQQgBUEIaiEFIAZBCGohBgwACwsgByABQQN0aiELAkADQCAHIAtPDQEgByAJKwMAIAcrAwCiIAorAwAgCCsDAKKhOQMAIAhEAAAAAAAAAAA5AwAgB0EIaiEHIAhBCGohCCAJQQhqIQkgCkEIaiEKDAALCws=';

let compiled;

function decode(base64) {
  if (typeof globalThis.atob === 'function') {
    return Uint8Array.from(globalThis.atob(base64), (char) =>
      char.charCodeAt(0)
    );
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function compile() {
  if (compiled === undefined) {
    try {
      compiled = new globalThis.WebAssembly.Module(decode(WASM));
    } catch {
      compiled = null;
    }
  }
  return compiled;
}

/** Array layout: [name, type, length key] in allocation order. */
const LAYOUT = [
  ['linkA', Int32Array, 'links'],
  ['linkB', Int32Array, 'links'],
  ['velocity', Float64Array, 'links'],
  ['damping', Float64Array, 'links'],
  ['conductance', Float64Array, 'links'],
  ['pressure', Float64Array, 'cells'],
  ['divergence', Float64Array, 'cells'],
  ['keep', Float64Array, 'cells'],
  ['gain', Float64Array, 'cells'],
];

/**
 * Create a kernel for a grid, or null without WebAssembly support.
 * `linkA`/`linkB` of the kernel hold cell *byte* offsets (index * 8).
 * @param {number} links
 * @param {number} cells
 * @returns {null | {arrays: Record<string, Float64Array|Int32Array>, step: () => void}}
 */
export function createKernel(links, cells) {
  const module = typeof globalThis.WebAssembly === 'object' ? compile() : null;
  if (!module) {
    return null;
  }
  const { memory, step } = new globalThis.WebAssembly.Instance(module, {})
    .exports;
  const counts = { links, cells };
  const bytes = LAYOUT.reduce(
    (total, [, Type, key]) =>
      total + Math.ceil((counts[key] * Type.BYTES_PER_ELEMENT) / 8) * 8,
    0
  );
  memory.grow(Math.max(0, Math.ceil(bytes / 65536) - 1));
  const arrays = {};
  let offset = 0;
  for (const [name, Type, key] of LAYOUT) {
    arrays[name] = new Type(memory.buffer, offset, counts[key]);
    offset += Math.ceil((counts[key] * Type.BYTES_PER_ELEMENT) / 8) * 8;
  }
  const at = LAYOUT.map(([name]) => arrays[name].byteOffset);
  return {
    arrays,
    step: () =>
      step(
        links,
        cells,
        at[0],
        at[1],
        at[2],
        at[3],
        at[4],
        at[5],
        at[6],
        at[7],
        at[8]
      ),
  };
}
