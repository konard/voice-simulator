// Rebuild the embedded FDTD wasm kernel from fdtd-kernel.wat.
// Usage: npm install --no-save wabt && node experiments/wasm/build.mjs
// Prints the base64 module to paste into src/acoustics/fdtd-kernel.js.
import { readFileSync } from 'node:fs';
import createWabt from 'wabt';

const wabt = await createWabt();
const source = readFileSync(
  new globalThis.URL('./fdtd-kernel.wat', import.meta.url),
  'utf8'
);
const { buffer } = wabt.parseWat('fdtd-kernel.wat', source).toBinary({});
console.log(Buffer.from(buffer).toString('base64'));
