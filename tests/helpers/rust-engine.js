/**
 * The Rust engine for parity tests.
 *
 * `noRust` is the reason to skip the tests that need the engine
 * (`itUnless(noRust)` of ./skip.js), or null when
 * `src/engine/voice-simulator.wasm` exists. The file is built by
 * `npm run build:wasm` and never committed, so a checkout without a Rust
 * toolchain skips these tests with a visible reason. CI sets
 * `REQUIRE_WASM=1` after the build: then a missing file throws here, at
 * import, so a broken build cannot pass as a skipped test.
 */

import { existsSync } from 'node:fs';

import {
  defaultEngineUrl,
  loadEngineModule,
} from '../../src/engine/wasm-loader.js';

const required = globalThis.process?.env?.REQUIRE_WASM === '1';
const present = existsSync(defaultEngineUrl());

if (required && !present) {
  throw new Error(
    'REQUIRE_WASM=1 but src/engine/voice-simulator.wasm is missing; run npm run build:wasm'
  );
}

/** @type {string|null} */
export const noRust = present
  ? null
  : 'no Rust engine; run npm run build:wasm to build src/engine/voice-simulator.wasm';

let loading;

/**
 * Load the engine, sharing one instance per test file.
 * @returns {ReturnType<typeof loadEngineModule>} never null: a present
 *   file that does not load is an error, not a reason to skip
 */
export function loadRustEngine() {
  loading ??= loadEngineModule().then((engine) => {
    if (!engine) {
      throw new Error(
        'src/engine/voice-simulator.wasm exists but did not load (no WebAssembly, or it does not compile)'
      );
    }
    return engine;
  });
  return loading;
}
