/**
 * Loader of the Rust engine (`src/engine/voice-simulator.wasm`, built by
 * `npm run build:wasm`; see docs/RUST-ENGINE.md), of its build with
 * WebAssembly SIMD (`voice-simulator-simd.wasm`, issue 23) when that file
 * is shipped and the runtime compiles it, and of its threads build
 * (`voice-simulator-threads.wasm`) when more than one thread is
 * asked for and the platform has shared memory.
 *
 * Hand-written on purpose: the module imports nothing (the threads build:
 * only its shared memory) and exports plain `vs_*` functions, so this file
 * and `thread-pool.js` are the whole glue, and the same code loads the
 * engine in a page, a worker, an AudioWorklet, Node.js, Bun and Deno.
 * No top-level `await` and no top-level import of `node:` modules, so the
 * file can be bundled for a browser.
 *
 * Every missing piece degrades to `null` and the caller keeps its JavaScript
 * engine: no `WebAssembly`, no file (the package is installed without a Rust
 * build) or a file that does not compile. Only an engine built for another
 * interface version throws, because that is a packaging bug to fix, not a
 * platform to tolerate.
 */

import { THREAD_MEMORY } from './layout.js';
import { createThreadPool } from './thread-pool.js';

/** The `vs_abi_version()` this loader speaks; see docs/RUST-ENGINE.md. */
export const ENGINE_ABI_VERSION = 2;

/** Where the engine lives next to this file. */
export function defaultEngineUrl() {
  return new globalThis.URL('./voice-simulator.wasm', import.meta.url);
}

/** Where the SIMD build of the engine lives next to this file. */
export function defaultSimdEngineUrl() {
  return new globalThis.URL('./voice-simulator-simd.wasm', import.meta.url);
}

/** Where the threads build of the engine lives next to this file. */
export function defaultThreadsEngineUrl() {
  return new globalThis.URL('./voice-simulator-threads.wasm', import.meta.url);
}

/** Most threads that `threads: 'auto'` asks for. */
export const AUTO_THREADS_MAX = 8;

/**
 * Cores of this machine: `navigator.hardwareConcurrency`, else
 * `os.availableParallelism()` of Node.js, else 1.
 * @returns {number}
 */
export function cores() {
  const hardware = globalThis.navigator?.hardwareConcurrency;
  if (Number.isInteger(hardware) && hardware > 0) {
    return hardware;
  }
  const os = globalThis.process?.getBuiltinModule?.('node:os');
  const parallelism = os?.availableParallelism?.();
  return Number.isInteger(parallelism) && parallelism > 0 ? parallelism : 1;
}

/**
 * The threads that the `threads` option asks for: 1 (the default), a
 * positive integer, or `'auto'`: all cores but one, at least 1 and at most
 * AUTO_THREADS_MAX.
 * @param {'auto' | number} [threads]
 * @returns {number}
 */
export function requestedThreads(threads = 1) {
  if (threads === 'auto') {
    return Math.min(AUTO_THREADS_MAX, Math.max(1, cores() - 1));
  }
  if (Number.isInteger(threads) && threads >= 1) {
    return threads;
  }
  throw new Error(
    `loadEngineModule: threads must be 'auto' or a positive integer`
  );
}

/**
 * A new shared memory of THREAD_MEMORY for the threads build, or null
 * when this platform cannot share memory between threads: a page that is
 * not cross-origin isolated (`crossOriginIsolated === false`), no
 * `SharedArrayBuffer`, or a runtime that refuses shared memory.
 * @param {typeof WebAssembly} wasm
 * @returns {WebAssembly.Memory | null}
 */
export function createSharedMemory(wasm = globalThis.WebAssembly) {
  if (
    globalThis.crossOriginIsolated === false ||
    typeof globalThis.SharedArrayBuffer !== 'function' ||
    typeof wasm?.Memory !== 'function'
  ) {
    return null;
  }
  try {
    return new wasm.Memory({
      initial: THREAD_MEMORY.INITIAL,
      maximum: THREAD_MEMORY.MAXIMUM,
      shared: true,
    });
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {value is ArrayBuffer | ArrayBufferView}
 */
function isBufferSource(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

/**
 * `node:fs/promises`, reached without a module specifier a bundler can see.
 * A dynamic import of that literal string made Vite swap in an empty browser
 * stub and warn on every build of the example app (issue 115), and webpack
 * rejects the `node:` scheme; only `file:` URLs get here, which a browser
 * never loads. `process.getBuiltinModule` exists in Node.js >= 20.16, Bun and
 * Deno; older Node.js 20 releases take the dynamic import.
 * @returns {Promise<{readFile: (url: URL) => Promise<Uint8Array>}>}
 */
async function nodeFs() {
  const specifier = 'node:fs/promises';
  const getBuiltinModule = globalThis.process?.getBuiltinModule;
  if (typeof getBuiltinModule === 'function') {
    return getBuiltinModule(specifier);
  }
  return await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
}

/**
 * Read the bytes behind a URL, or null when they cannot be read.
 * @param {URL} url
 * @returns {Promise<ArrayBuffer | Uint8Array | null>}
 */
async function readUrl(url) {
  try {
    if (url.protocol === 'file:') {
      const { readFile } = await nodeFs();
      return await readFile(url);
    }
    const response = await fetch(url);
    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/**
 * @param {typeof WebAssembly} wasm
 * @param {unknown} source
 * @returns {Promise<WebAssembly.Module | null>}
 */
async function compileSource(wasm, source) {
  if (source instanceof wasm.Module) {
    return source;
  }
  let bytes = source;
  if (!isBufferSource(source)) {
    bytes = await readUrl(new globalThis.URL(String(source), import.meta.url));
  }
  if (!bytes) {
    return null;
  }
  try {
    return await wasm.compile(bytes);
  } catch {
    return null;
  }
}

/**
 * Load the engine.
 *
 * @param {WebAssembly.Module | ArrayBuffer | ArrayBufferView | URL | string}
 *   [source] a compiled module, the bytes of a file, or its URL; nothing
 *   means the files next to this file (read with `node:fs/promises` for a
 *   `file:` URL and with `fetch` otherwise): `./voice-simulator-threads.wasm`
 *   when `threads` allows, else `./voice-simulator-simd.wasm` or
 *   `./voice-simulator.wasm` as `simd` says
 * @param {{simd?: 'auto' | boolean, threads?: 'auto' | number}} [options]
 *   `simd`: with no `source`,
 *   `'auto'` (the default) tries the SIMD file first and loads the scalar
 *   file when it is missing or does not compile, `false` loads only the
 *   scalar file and `true` only the SIMD file. With a `source`, the source
 *   is loaded and `true` (`false`) gives null when it is not (is) a SIMD
 *   build. `threads`: 1 (the default), a positive integer or `'auto'`
 *   (all cores but one, at most AUTO_THREADS_MAX). With more than 1, the
 *   threads file is loaded and its helper workers started when the file
 *   exists, `globalThis.crossOriginIsolated !== false`, `SharedArrayBuffer`
 *   exists and the shared memory can be created; otherwise, or when a
 *   worker cannot start, the engine runs on one thread, which is never an
 *   error. A `source` that is a threads build gets the shared memory too.
 * @returns {Promise<{exports: Record<string, Function | WebAssembly.Memory>,
 *   memory: WebAssembly.Memory, abiVersion: number, simd: boolean,
 *   threads: number, pool: Awaited<ReturnType<typeof createThreadPool>> |
 *   null, close: () => void} | null>}
 *   `simd` tells whether the engine was built with WebAssembly SIMD
 *   (`vs_simd()`, false when it is not exported); `threads` how many
 *   threads can step the 3D solver (1 without a pool of helpers); `close()`
 *   ends the helpers (a no-op on one thread). Null when WebAssembly is
 *   missing, the file is missing or it does not compile
 * @throws {Error} when the engine reports another `vs_abi_version()`, or
 *   for an option that is not one of the values above
 */
export async function loadEngineModule(source, options = {}) {
  const simd = simdOption(options);
  const threads = requestedThreads(options.threads);
  if (source !== undefined && source !== null) {
    return matching(await loadOne(source, threads), simd);
  }
  if (threads > 1 && createSharedMemory()) {
    const engine = matching(
      await loadOne(defaultThreadsEngineUrl(), threads),
      simd
    );
    if (engine && engine.threads > 1) {
      return engine;
    }
    engine?.close();
  }
  if (simd !== false) {
    const engine = matching(await loadOne(defaultSimdEngineUrl()), true);
    if (engine || simd === true) {
      return engine;
    }
  }
  return matching(await loadOne(defaultEngineUrl()), false);
}

/** The `simd` option, checked. */
function simdOption(options) {
  const simd = options.simd ?? 'auto';
  if (simd !== 'auto' && typeof simd !== 'boolean') {
    throw new Error(`loadEngineModule: simd must be 'auto', true or false`);
  }
  return simd;
}

/**
 * `engine` when its `simd` agrees with the wanted one, else null (its
 * helpers ended).
 */
function matching(engine, simd) {
  if (engine && simd !== 'auto' && engine.simd !== simd) {
    engine.close();
    return null;
  }
  return engine;
}

/** Whether `module` imports its memory: the threads build. */
function importsMemory(wasm, module) {
  return wasm.Module.imports(module).some((entry) => entry.kind === 'memory');
}

/** An instance of `module`, on `memory` when it imports one; or null. */
async function instantiate(wasm, module, memory) {
  try {
    const imports = memory ? { env: { memory } } : {};
    return (await wasm.instantiate(module, imports)).exports;
  } catch {
    return null;
  }
}

/** `vs_abi_version()` of `exports`, checked against ENGINE_ABI_VERSION. */
function abiVersionOf(exports) {
  const abiVersion =
    typeof exports.vs_abi_version === 'function'
      ? exports.vs_abi_version()
      : undefined;
  if (abiVersion !== ENGINE_ABI_VERSION) {
    throw new Error(
      `voice-simulator.wasm speaks engine interface ${abiVersion ?? '(none: no vs_abi_version export)'}, ` +
        `this loader speaks ${ENGINE_ABI_VERSION}; rebuild it with npm run build:wasm`
    );
  }
  return abiVersion;
}

/**
 * One engine file, or null when it cannot be loaded. A threads build gets
 * a new shared memory and, for `threads` above 1, a pool of helpers; it
 * stays on one thread when the pool cannot start.
 */
async function loadOne(source, threads = 1) {
  const wasm = globalThis.WebAssembly;
  if (typeof wasm !== 'object' || wasm === null) {
    return null;
  }
  const module = await compileSource(wasm, source);
  if (!module) {
    return null;
  }
  const shared = importsMemory(wasm, module);
  const memory = shared ? createSharedMemory(wasm) : null;
  if (shared && !memory) {
    return null;
  }
  const exports = await instantiate(wasm, module, memory);
  if (!exports) {
    return null;
  }
  const abiVersion = abiVersionOf(exports);
  // An engine without `vs_simd` (older or minimal builds) is scalar.
  const simd = typeof exports.vs_simd === 'function' && exports.vs_simd() === 1;
  const pool = shared
    ? await startPool(module, memory, threads, exports)
    : null;
  return {
    exports,
    memory: memory ?? exports.memory,
    abiVersion,
    simd,
    threads: pool?.size ?? 1,
    pool,
    close() {
      pool?.close();
    },
  };
}

/** The helpers of a threads build, or null for one thread or a failure. */
async function startPool(module, memory, threads, exports) {
  if (threads <= 1 || exports.vs_threads?.() !== 1) {
    return null;
  }
  try {
    return await createThreadPool(module, memory, threads, { exports });
  } catch {
    return null;
  }
}

/**
 * A fresh `Float64Array` over `count` values at byte offset `pointer`.
 * Create views again after every call that can allocate: growing the
 * memory detaches every view made before.
 * @param {{memory: WebAssembly.Memory}} engine
 * @param {number} pointer
 * @param {number} count
 */
export function float64View(engine, pointer, count) {
  return new Float64Array(engine.memory.buffer, pointer, count);
}

/**
 * A fresh `Uint16Array` over `count` code units at byte offset `pointer`.
 * @param {{memory: WebAssembly.Memory}} engine
 * @param {number} pointer
 * @param {number} count
 */
export function uint16View(engine, pointer, count) {
  return new Uint16Array(engine.memory.buffer, pointer, count);
}

/**
 * A fresh `Float32Array` over `count` samples at byte offset `pointer`.
 * @param {{memory: WebAssembly.Memory}} engine
 * @param {number} pointer
 * @param {number} count
 */
export function float32View(engine, pointer, count) {
  return new Float32Array(engine.memory.buffer, pointer, count);
}
