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

/* global URL */

/** The `vs_abi_version()` this loader speaks; see docs/RUST-ENGINE.md. */
export const ENGINE_ABI_VERSION = 3;

/**
 * Where the engine lives next to this file. Written as the literal
 * `new URL('./file', import.meta.url)` so bundlers (Vite, webpack, Rollup)
 * see the asset, copy it to their output and rewrite the URL.
 */
export function defaultEngineUrl() {
  return new URL('./voice-simulator.wasm', import.meta.url);
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
 *   (`vs_simd()`, false when it is not exported); null when WebAssembly
 *   is missing, the file is missing or it does not compile
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
  return engineOf(instance);
}

/** The engine of an instance; throws on another interface version. */
function engineOf(instance) {
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
  // An engine without `vs_simd` (older or minimal builds) is scalar.
  const simd = typeof exports.vs_simd === 'function' && exports.vs_simd() === 1;
  return { exports, memory: exports.memory, abiVersion, simd };
}

/**
 * loadEngineModule without a promise, for `getEngine` of ./index.js: it
 * reads a `file:` URL with `readFileSync` and compiles with
 * `new WebAssembly.Module`. Only where `process.getBuiltinModule` exists
 * (Node.js, Bun, Deno); elsewhere (browsers) it returns undefined, which
 * means "cannot tell without awaiting", unlike null ("no engine").
 * @param {Parameters<typeof loadEngineModule>[0]} [source]
 * @param {Parameters<typeof loadEngineModule>[1]} [options]
 * @returns {Awaited<ReturnType<typeof loadEngineModule>> | undefined}
 */
export function loadEngineModuleSync(source, options = {}) {
  const getBuiltinModule = globalThis.process?.getBuiltinModule;
  if (typeof getBuiltinModule !== 'function') {
    return undefined;
  }
  const simd = simdOption(options);
  const one = (from) => loadOneSync(from, getBuiltinModule('node:fs'));
  if (source !== undefined && source !== null) {
    return matching(one(source), simd);
  }
  if (simd !== false) {
    const engine = matching(one(defaultSimdEngineUrl()), true);
    if (engine || simd === true) {
      return engine;
    }
  }
  return matching(one(defaultEngineUrl()), false);
}

/** loadOne without a promise; only `file:` URLs are read. */
function loadOneSync(source, fs) {
  const wasm = globalThis.WebAssembly;
  if (typeof wasm !== 'object' || wasm === null) {
    return null;
  }
  let module;
  try {
    if (source instanceof wasm.Module) {
      module = source;
    } else {
      let bytes = source;
      if (!isBufferSource(source)) {
        const url = new globalThis.URL(String(source), import.meta.url);
        if (url.protocol !== 'file:') {
          return null;
        }
        bytes = fs.readFileSync(url);
      }
      module = new wasm.Module(bytes);
    }
  } catch {
    return null;
  }
  let instance;
  try {
    instance = new wasm.Instance(module, {});
  } catch {
    return null;
  }
  return engineOf(instance);
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
