/**
 * Loader of the Rust engine (`src/engine/voice-simulator.wasm`, built by
 * `npm run build:wasm`; see docs/RUST-ENGINE.md), and of its build with
 * WebAssembly SIMD (`voice-simulator-simd.wasm`, issue 23) when that file
 * is shipped and the runtime compiles it.
 *
 * Hand-written on purpose: the module imports nothing and exports plain
 * `vs_*` functions, so this file is the whole glue, and the same code loads
 * the engine in a page, a worker, an AudioWorklet, Node.js, Bun and Deno.
 * No top-level `await` and no top-level import of `node:` modules, so the
 * file can be bundled for a browser.
 *
 * Every missing piece degrades to `null` and the caller keeps its JavaScript
 * engine: no `WebAssembly`, no file (the package is installed without a Rust
 * build) or a file that does not compile. Only an engine built for another
 * interface version throws, because that is a packaging bug to fix, not a
 * platform to tolerate.
 */

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

/**
 * @param {unknown} value
 * @returns {value is ArrayBuffer | ArrayBufferView}
 */
function isBufferSource(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

/**
 * Read the bytes behind a URL, or null when they cannot be read.
 * @param {URL} url
 * @returns {Promise<ArrayBuffer | Uint8Array | null>}
 */
async function readUrl(url) {
  try {
    if (url.protocol === 'file:') {
      const { readFile } = await import('node:fs/promises');
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
 *   `file:` URL and with `fetch` otherwise): `./voice-simulator-simd.wasm`
 *   or `./voice-simulator.wasm` as `simd` says
 * @param {{simd?: 'auto' | boolean}} [options] `simd`: with no `source`,
 *   `'auto'` (the default) tries the SIMD file first and loads the scalar
 *   file when it is missing or does not compile, `false` loads only the
 *   scalar file and `true` only the SIMD file. With a `source`, the source
 *   is loaded and `true` (`false`) gives null when it is not (is) a SIMD
 *   build.
 * @returns {Promise<{exports: Record<string, Function | WebAssembly.Memory>,
 *   memory: WebAssembly.Memory, abiVersion: number, simd: boolean} | null>}
 *   `simd` tells whether the engine was built with WebAssembly SIMD
 *   (`vs_simd()`); null when WebAssembly is missing, the file is missing or
 *   it does not compile
 * @throws {Error} when the engine reports another `vs_abi_version()`
 */
export async function loadEngineModule(source, options = {}) {
  const simd = simdOption(options);
  if (source !== undefined && source !== null) {
    return matching(await loadOne(source), simd);
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

/** `engine` when its `simd` agrees with the wanted one, else null. */
function matching(engine, simd) {
  return engine && (simd === 'auto' || engine.simd === simd) ? engine : null;
}

/** One engine file, or null when it cannot be loaded. */
async function loadOne(source) {
  const wasm = globalThis.WebAssembly;
  if (typeof wasm !== 'object' || wasm === null) {
    return null;
  }
  const module = await compileSource(wasm, source);
  if (!module) {
    return null;
  }
  let instance;
  try {
    instance = await wasm.instantiate(module, {});
  } catch {
    return null;
  }
  const { exports } = instance;
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
  const simd = exports.vs_simd() === 1;
  return { exports, memory: exports.memory, abiVersion, simd };
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
