/**
 * The engine that renders a voice (issue 25): the Rust engine
 * (`voice-simulator.wasm`, see docs/RUST-ENGINE.md) by default, the
 * JavaScript renderer where the Rust engine cannot load or cannot render
 * the asked options.
 *
 * `createEngine` loads an engine and `getEngine` gives one without a
 * promise; both cache the engine by `engine|threads|simd`, so the file is
 * read and compiled once. The engine makes renderers: a RustVoiceRenderer
 * when it is the Rust engine and the options are ones Rust supports, else a
 * VoiceRenderer. Every renderer it makes says which engine renders
 * (`renderer.engine`) and why it is not Rust (`renderer.fallbackReason`).
 */

import { VoiceRenderer } from '../acoustics/voice.js';
import { RustVoiceRenderer, checkSupported } from './rust-renderer.js';
import { loadEngineModule, loadEngineModuleSync } from './wasm-loader.js';

/** The values of the `engine` option. */
export const ENGINE_NAMES = Object.freeze(['auto', 'rust', 'js']);

/** Engines loaded from the default files, by `engine|threads|simd`. */
const engines = new Map();
/** Loads in progress, by the same key. */
const pending = new Map();

/**
 * An Error with `code = 'ENGINE_UNAVAILABLE'`: the Rust engine was asked
 * for and cannot load.
 * @param {string} message
 */
function unavailable(message) {
  const error = new Error(message);
  error.code = 'ENGINE_UNAVAILABLE';
  return error;
}

/** Whether `value` is an engine object (made here or by a caller). */
function isEngine(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.createRenderer === 'function'
  );
}

/** The checked options of createEngine and their cache key. */
function engineSettings(options) {
  const settings =
    typeof options === 'string' ? { engine: options } : (options ?? {});
  const engine = settings.engine ?? 'auto';
  if (!ENGINE_NAMES.includes(engine)) {
    throw new Error(`Unknown engine: ${engine}`);
  }
  const threads = settings.threads ?? 1;
  if (threads !== 'auto' && !(Number.isInteger(threads) && threads > 0)) {
    throw new Error(
      `threads must be a positive integer or 'auto', not ${threads}`
    );
  }
  const simd = settings.simd ?? 'auto';
  if (simd !== 'auto' && typeof simd !== 'boolean') {
    throw new Error(`simd must be 'auto', true or false, not ${simd}`);
  }
  const { source } = settings;
  return {
    engine,
    threads,
    simd,
    source,
    // An engine from a given source is not shared: the next caller may
    // ask for the default files.
    key: source === undefined ? `${engine}|${threads}|${simd}` : null,
  };
}

/** Why the Rust engine did not load. */
function missingReason() {
  return typeof globalThis.WebAssembly === 'object'
    ? 'the Rust engine (voice-simulator.wasm) is missing or does not compile'
    : 'this runtime has no WebAssembly';
}

/**
 * A rendering engine: the Rust engine or the JavaScript renderer.
 */
export class Engine {
  /**
   * @param {{name: 'rust'|'js', requested: 'auto'|'rust'|'js', module?: object|null, reason?: string|null, key?: string|null}} settings
   */
  constructor({ name, requested, module = null, reason = null, key = null }) {
    /** `'rust'` or `'js'`: the engine that renders. */
    this.name = name;
    /** The `engine` option it was created for. */
    this.requested = requested;
    /** Whether the Rust engine was built with WebAssembly SIMD. */
    this.simd = Boolean(module?.simd);
    /** Threads the engine renders with (1: no threads yet, issue 24). */
    this.threads = 1;
    /** Why the engine is JavaScript under `'auto'`, else null. */
    this.reason = reason;
    this.module = module;
    this.key = key;
  }

  /** Optional engine features in use (none yet). */
  features() {
    return [];
  }

  /**
   * Why this engine renders `renderOptions` in JavaScript, or null when it
   * renders them itself. The microphone and the room are checked when the
   * renderer is built (createRenderer falls back then).
   * @param {object} [renderOptions] as for VoiceRenderer
   * @returns {string|null}
   */
  supports(renderOptions = {}) {
    if (this.name !== 'rust') {
      return null;
    }
    try {
      checkSupported(renderOptions);
      return null;
    } catch (error) {
      if (error.code !== 'ENGINE_UNSUPPORTED') {
        throw error;
      }
      return error.message;
    }
  }

  /**
   * A renderer of `plan`: a RustVoiceRenderer when this is the Rust engine
   * and it supports the options, else a VoiceRenderer. Free a Rust
   * renderer with `free()` when done.
   * @param {object} plan Result of planUtterance.
   * @param {object} [renderOptions] as for VoiceRenderer
   * @returns {(VoiceRenderer|RustVoiceRenderer) & {engine: 'rust'|'js', fallbackReason: string|null}}
   */
  createRenderer(plan, renderOptions = {}) {
    let reason = this.reason;
    if (this.name === 'rust') {
      if (!this.module) {
        throw new Error('createRenderer: the engine is closed');
      }
      reason = this.supports(renderOptions);
      if (reason === null) {
        try {
          return tagged(
            new RustVoiceRenderer(this.module, plan, renderOptions),
            'rust',
            null
          );
        } catch (error) {
          if (error.code !== 'ENGINE_UNSUPPORTED') {
            throw error;
          }
          reason = error.message;
        }
      }
    }
    return tagged(new VoiceRenderer(plan, renderOptions), 'js', reason);
  }

  /** Drop the engine (and its cache entry): the next load starts afresh. */
  close() {
    if (this.key !== null && engines.get(this.key) === this) {
      engines.delete(this.key);
    }
    this.module = null;
  }
}

function tagged(renderer, engine, fallbackReason) {
  renderer.engine = engine;
  renderer.fallbackReason = fallbackReason;
  return renderer;
}

/** The engine for a loaded (or missing) module, cached by its key. */
function finish(settings, module) {
  const { engine: requested, key } = settings;
  let engine;
  if (module) {
    engine = new Engine({ name: 'rust', requested, module, key });
  } else if (requested === 'rust') {
    throw unavailable(`Rust engine unavailable: ${missingReason()}`);
  } else {
    engine = new Engine({
      name: 'js',
      requested,
      reason: requested === 'js' ? null : missingReason(),
      key,
    });
  }
  if (key !== null) {
    engines.set(key, engine);
  }
  return engine;
}

/**
 * Load an engine.
 *
 * `engine` is `'auto'` (the default: Rust when it loads, else JavaScript
 * with `reason` set), `'rust'` (an error with `code = 'ENGINE_UNAVAILABLE'`
 * when it does not load) or `'js'` (never loads WebAssembly). `threads`
 * (default 1, a positive integer or `'auto'`), `simd` (default `'auto'`)
 * and `source` go to loadEngineModule unchanged. An engine object is
 * returned as it is.
 * @param {'auto'|'rust'|'js'|Engine|{engine?: 'auto'|'rust'|'js'|Engine, threads?: number|'auto', simd?: 'auto'|boolean, source?: Parameters<typeof loadEngineModule>[0]}} [options]
 * @returns {Promise<Engine>}
 */
export async function createEngine(options = {}) {
  if (isEngine(options)) {
    return options;
  }
  if (isEngine(options?.engine)) {
    return options.engine;
  }
  const settings = engineSettings(options);
  const { key } = settings;
  if (key !== null && engines.has(key)) {
    return engines.get(key);
  }
  if (key !== null && pending.has(key)) {
    return pending.get(key);
  }
  const loading = (async () => {
    if (settings.engine === 'js') {
      return finish(settings, null);
    }
    const { source, threads, simd } = settings;
    return finish(settings, await loadEngineModule(source, { threads, simd }));
  })();
  if (key === null) {
    return loading;
  }
  pending.set(key, loading);
  try {
    return await loading;
  } finally {
    pending.delete(key);
  }
}

/**
 * createEngine without a promise. Gives the cached engine; else, where
 * `process.getBuiltinModule` exists (Node.js, Bun, Deno), it loads the
 * engine synchronously. Elsewhere (browsers) `'auto'` gives the JavaScript
 * engine and `'rust'` throws `ENGINE_UNAVAILABLE`: call
 * `await createEngine()` first there.
 * @param {Parameters<typeof createEngine>[0]} [options]
 * @returns {Engine}
 */
export function getEngine(options = {}) {
  if (isEngine(options)) {
    return options;
  }
  if (isEngine(options?.engine)) {
    return options.engine;
  }
  const settings = engineSettings(options);
  const { key } = settings;
  if (key !== null && engines.has(key)) {
    return engines.get(key);
  }
  if (settings.engine === 'js') {
    return finish(settings, null);
  }
  const { source, threads, simd } = settings;
  const module = loadEngineModuleSync(source, { threads, simd });
  if (module !== undefined) {
    return finish(settings, module);
  }
  const reason =
    'the Rust engine loads asynchronously here; call await createEngine() first';
  if (settings.engine === 'rust') {
    throw unavailable(`Rust engine unavailable: ${reason}`);
  }
  // Not cached: a later createEngine() may still load Rust.
  return new Engine({ name: 'js', requested: settings.engine, reason });
}
