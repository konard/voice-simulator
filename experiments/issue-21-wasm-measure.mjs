#!/usr/bin/env node

/**
 * Measurements for issue 21 (Rust workspace and WebAssembly build).
 *
 *   node experiments/issue-21-wasm-measure.mjs
 *
 * 1. Builds the engine twice with a clean `target/` for the wasm crate and
 *    prints the size, the SHA-256 and the wall time of each build: both
 *    hashes must be equal.
 * 2. Compares `voice-simulator-cli random 1 3` with the bits of the first
 *    three values of `createRandom(1)`.
 * 3. Times 1 000 000 uniform values in JavaScript and in the wasm engine.
 *
 * Needs cargo and the toolchain of rust-toolchain.toml.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeWasm, ENGINE_WASM } from '../scripts/build-wasm.mjs';
import { createRandom } from '../src/random.js';
import { float64View, loadEngineModule } from '../src/engine/wasm-loader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function bits(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

const builds = [];
for (let build = 1; build <= 2; build++) {
  run('cargo', [
    'clean',
    '--release',
    '--target',
    'wasm32-unknown-unknown',
    '-p',
    'voice-simulator-wasm',
  ]);
  const start = performance.now();
  run('node', ['scripts/build-wasm.mjs', '--require', '--check-size']);
  const seconds = (performance.now() - start) / 1000;
  const { size, sha256 } = describeWasm(
    readFileSync(path.join(root, ENGINE_WASM))
  );
  builds.push({ size, sha256 });
  console.log(
    `build ${build}: ${size} bytes, SHA-256 ${sha256}, ${seconds.toFixed(1)} s`
  );
}
console.log(
  `reproducible: ${builds[0].sha256 === builds[1].sha256 ? 'yes' : 'NO'}`
);

const cli = run('cargo', [
  'run',
  '-q',
  '--locked',
  '-p',
  'voice-simulator-cli',
  '--',
  'random',
  '1',
  '3',
])
  .trim()
  .split('\n');
const random = createRandom(1);
const js = [random(), random(), random()].map(bits);
console.log(`cli random 1 3: ${cli.join(' ')}`);
console.log(`js createRandom(1): ${js.join(' ')}`);
console.log(`cli matches js: ${cli.join() === js.join() ? 'yes' : 'NO'}`);

const count = 1_000_000;
const engine = await loadEngineModule(
  readFileSync(path.join(root, ENGINE_WASM))
);
const pointer = engine.exports.vs_alloc(count * 8);
let start = performance.now();
engine.exports.vs_random_fill(42, pointer, count);
const wasmMs = performance.now() - start;
const wasmSum = float64View(engine, pointer, count).reduce((a, b) => a + b, 0);
start = performance.now();
const next = createRandom(42);
const values = new Float64Array(count);
for (let index = 0; index < count; index++) {
  values[index] = next();
}
const jsMs = performance.now() - start;
const jsSum = values.reduce((a, b) => a + b, 0);
console.log(
  `${count} uniform values: wasm ${wasmMs.toFixed(1)} ms, js ${jsMs.toFixed(1)} ms, sums equal: ${Object.is(wasmSum, jsSum) ? 'yes' : 'NO'}`
);
