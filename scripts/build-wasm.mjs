#!/usr/bin/env node

/**
 * Build the Rust engine into its WebAssembly files.
 *
 *   node scripts/build-wasm.mjs [--check-size] [--require]
 *
 * Runs `cargo build --release --locked --target wasm32-unknown-unknown
 * -p voice-simulator-wasm`, copies the result to
 * src/engine/voice-simulator.wasm and prints its size in bytes and its
 * SHA-256. Then builds the same crate again with WebAssembly SIMD
 * (`RUSTFLAGS="-C target-feature=+simd128"`, `--target-dir target/simd`,
 * issue 23) and copies it to src/engine/voice-simulator-simd.wasm when
 * SHIP_SIMD is true; the loader picks that file when the runtime compiles
 * it. The output depends only on the compiler pinned in
 * rust-toolchain.toml, so two builds print the same hashes.
 *
 * --check-size  exit with 1 when a shipped file is larger than
 *               WASM_SIZE_BUDGET
 * --require     exit with 1 when cargo is not installed (CI); without it a
 *               missing cargo is not an error, because the package falls
 *               back to its JavaScript engine
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Largest allowed size of each shipped engine file in bytes: the size
 * measured when the budget was last raised, rounded up to the next 16 384
 * bytes. Raised for issue 23 (the 3D FDTD solver and its kernels) from
 * 98 304 to 196 608 (scalar file 184 968 bytes, SIMD file 192 648 bytes,
 * Rust 1.100.0), and for issue 52 (vocal effort in the glottis and the
 * renderer) to 212 992 (scalar file 196 952 bytes). Raise it only with the
 * newly measured size in the commit message.
 */
export const WASM_SIZE_BUDGET = 212992;

/**
 * Whether src/engine/voice-simulator-simd.wasm is shipped: only when it
 * measured at least 1.15 times faster than the scalar file on the `high`
 * tier (tests/heavy/performance-rust-fdtd.test.js; the numbers are in
 * docs/RUST-ENGINE.md). The SIMD build runs either way, so the code keeps
 * compiling.
 */
export const SHIP_SIMD = false;

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

/** The SIMD build: its own target directory, so neither evicts the other. */
export const SIMD_TARGET_DIR = 'target/simd';
export const SIMD_CARGO_ARGS = [...CARGO_ARGS, '--target-dir', SIMD_TARGET_DIR];
export const SIMD_RUSTFLAGS = '-C target-feature=+simd128';
export const SIMD_BUILT_WASM = `${SIMD_TARGET_DIR}/wasm32-unknown-unknown/release/voice_simulator_wasm.wasm`;
export const SIMD_ENGINE_WASM = 'src/engine/voice-simulator-simd.wasm';

/**
 * The builds, in order: cargo arguments, extra RUSTFLAGS, the built file,
 * the shipped file and whether it is shipped.
 * @type {{name: string, args: string[], rustflags: string, built: string,
 *   engine: string, ship: boolean}[]}
 */
export const BUILDS = [
  {
    name: 'scalar',
    args: CARGO_ARGS,
    rustflags: '',
    built: BUILT_WASM,
    engine: ENGINE_WASM,
    ship: true,
  },
  {
    name: 'simd',
    args: SIMD_CARGO_ARGS,
    rustflags: SIMD_RUSTFLAGS,
    built: SIMD_BUILT_WASM,
    engine: SIMD_ENGINE_WASM,
    ship: SHIP_SIMD,
  },
];

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
 * @param {string} [file]
 * @returns {string|null} why the size is over the budget, or null
 */
export function sizeProblem(
  size,
  budget = WASM_SIZE_BUDGET,
  file = ENGINE_WASM
) {
  return size > budget
    ? `${file} is ${size} bytes, over WASM_SIZE_BUDGET (${budget} bytes) by ${size - budget}`
    : null;
}

/** The environment of a build: `env` with its RUSTFLAGS appended. */
export function buildEnv(env, rustflags) {
  if (!rustflags) {
    return env;
  }
  const flags = [env.RUSTFLAGS, rustflags].filter(Boolean).join(' ');
  return { ...env, RUSTFLAGS: flags };
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

/** Run every build of BUILDS; returns the exit code. */
function buildAndReport({ options, root, env, log, error }) {
  log(`WASM_SIZE_BUDGET: ${WASM_SIZE_BUDGET} bytes`);
  for (const build of BUILDS) {
    const code = runBuild({ build, options, root, env, log, error });
    if (code !== 0) {
      return code;
    }
  }
  return 0;
}

/** One build: cargo, copy when shipped, size and hash; the exit code. */
function runBuild({ build, options, root, env, log, error }) {
  const prefix = build.rustflags ? `RUSTFLAGS="${build.rustflags}" ` : '';
  log(`${prefix}cargo ${build.args.join(' ')}`);
  const cargo = spawnSync('cargo', build.args, {
    cwd: root,
    env: buildEnv(env, build.rustflags),
    stdio: 'inherit',
  });
  if (cargo.error || cargo.status !== 0) {
    error(
      `cargo build (${build.name}) failed (${cargo.error?.message ?? `exit ${cargo.status}`})`
    );
    return 1;
  }
  const built = path.join(root, build.built);
  const { size, sha256 } = describeWasm(readFileSync(built));
  if (!build.ship) {
    rmSync(path.join(root, build.engine), { force: true });
    log(`${build.built}: ${size} bytes (not shipped)`);
    log(`SHA-256: ${sha256}`);
    return 0;
  }
  const target = path.join(root, build.engine);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(built, target);
  log(`${build.engine}: ${size} bytes`);
  log(`SHA-256: ${sha256}`);
  const problem = sizeProblem(size, WASM_SIZE_BUDGET, build.engine);
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
