#!/usr/bin/env node

/**
 * Build the Rust engine into one WebAssembly file.
 *
 *   node scripts/build-wasm.mjs [--check-size] [--require]
 *
 * Runs `cargo build --release --locked --target wasm32-unknown-unknown
 * -p voice-simulator-wasm`, copies the result to
 * src/engine/voice-simulator.wasm and prints its size in bytes and its
 * SHA-256. The output depends only on the compiler pinned in
 * rust-toolchain.toml, so two builds print the same hash.
 *
 * --check-size  exit with 1 when the file is larger than WASM_SIZE_BUDGET
 * --require     exit with 1 when cargo is not installed (CI); without it a
 *               missing cargo is not an error, because the package falls
 *               back to its JavaScript engine
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Largest allowed size of src/engine/voice-simulator.wasm in bytes: the
 * size measured when the budget was last raised, rounded up to the next
 * 16 384 bytes: 93 300 bytes with Rust 1.100.0, once the waveguide voice
 * renderer of issue 22, with the frequency-dependent losses of issue 36,
 * joined the resampler of issue 27. Raise it only with the newly measured
 * size in the commit message.
 */
export const WASM_SIZE_BUDGET = 98304;

export const CARGO_ARGS = [
  'build',
  '--release',
  '--locked',
  '--target',
  'wasm32-unknown-unknown',
  '-p',
  'voice-simulator-wasm',
];

export const BUILT_WASM =
  'target/wasm32-unknown-unknown/release/voice_simulator_wasm.wasm';
export const ENGINE_WASM = 'src/engine/voice-simulator.wasm';

export const NO_CARGO_MESSAGE =
  'cargo not found: the JavaScript engine will be used';

/**
 * @param {string[]} argv
 * @returns {{checkSize: boolean, require: boolean}}
 */
export function parseArgs(argv) {
  const options = { checkSize: false, require: false };
  for (const arg of argv) {
    if (arg === '--check-size') {
      options.checkSize = true;
    } else if (arg === '--require') {
      options.require = true;
    } else {
      throw new Error(
        `Unknown argument ${arg}; usage: build-wasm.mjs [--check-size] [--require]`
      );
    }
  }
  return options;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{size: number, sha256: string}}
 */
export function describeWasm(bytes) {
  return {
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * @param {number} size
 * @param {number} [budget]
 * @returns {string|null} why the size is over the budget, or null
 */
export function sizeProblem(size, budget = WASM_SIZE_BUDGET) {
  return size > budget
    ? `${ENGINE_WASM} is ${size} bytes, over WASM_SIZE_BUDGET (${budget} bytes) by ${size - budget}`
    : null;
}

/** Whether `cargo` can be started at all. */
function cargoInstalled(env) {
  const probe = spawnSync('cargo', ['--version'], { env, stdio: 'ignore' });
  return !probe.error;
}

/**
 * @param {{argv?: string[], root?: string, env?: NodeJS.ProcessEnv,
 *   log?: (line: string) => void, error?: (line: string) => void}} [options]
 * @returns {number} exit code
 */
export function main({
  argv = process.argv.slice(2),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  env = process.env,
  log = console.log,
  error = console.error,
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (problem) {
    error(problem.message);
    return 2;
  }
  if (!cargoInstalled(env)) {
    (options.require ? error : log)(NO_CARGO_MESSAGE);
    return options.require ? 1 : 0;
  }
  return buildAndReport({ options, root, env, log, error });
}

/** Run cargo, copy the file and print its size and hash; returns the exit code. */
function buildAndReport({ options, root, env, log, error }) {
  log(`cargo ${CARGO_ARGS.join(' ')}`);
  const build = spawnSync('cargo', CARGO_ARGS, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (build.error || build.status !== 0) {
    error(
      `cargo build failed (${build.error?.message ?? `exit ${build.status}`})`
    );
    return 1;
  }
  const target = path.join(root, ENGINE_WASM);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(root, BUILT_WASM), target);
  const { size, sha256 } = describeWasm(readFileSync(target));
  log(`${ENGINE_WASM}: ${size} bytes`);
  log(`SHA-256: ${sha256}`);
  log(`WASM_SIZE_BUDGET: ${WASM_SIZE_BUDGET} bytes`);
  const problem = sizeProblem(size);
  if (problem && options.checkSize) {
    error(problem);
    return 1;
  }
  if (problem) {
    log(`warning: ${problem}`);
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = main();
}
