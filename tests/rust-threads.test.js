/**
 * The 3D solver on several threads in WebAssembly (issue 24): the
 * `threads` option of loadEngineModule, its fallback to one thread, and
 * renders on 2 and 4 threads that are the same bits as on one.
 *
 * Skipped without src/engine/voice-simulator.wasm (see
 * ./helpers/rust-engine.js). The tests of the threads build also need
 * src/engine/voice-simulator-threads.wasm (`node scripts/build-wasm.mjs
 * --threads`, a nightly compiler) and a runtime with SharedArrayBuffer;
 * they are skipped with the reason otherwise, and REQUIRE_THREADS_WASM=1
 * turns a missing file into an error (CI).
 *
 * The bit-identity check renders 'Hello.' for 0.2 s in a 40 cm room, about
 * 16 s per render on one thread; it is three tests that share the render
 * on one thread, so that every test stays within the 30 s per test of
 * `npm test`.
 */

import { existsSync } from 'node:fs';

import { describe, expect } from 'test-anywhere';

import { createEngine, getEngine } from '../src/engine/index.js';
import { RustVoiceRenderer } from '../src/engine/rust-renderer.js';
import {
  AUTO_THREADS_MAX,
  createSharedMemory,
  defaultThreadsEngineUrl,
  loadEngineModule,
  requestedThreads,
} from '../src/engine/wasm-loader.js';
import { prepareUtterance } from '../src/synthesize.js';
import { noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const threadsFile = existsSync(defaultThreadsEngineUrl());
if (globalThis.process?.env?.REQUIRE_THREADS_WASM === '1' && !threadsFile) {
  throw new Error(
    'REQUIRE_THREADS_WASM=1 but src/engine/voice-simulator-threads.wasm is missing; run node scripts/build-wasm.mjs --threads'
  );
}

/** Why the tests of the threads build cannot run, or null. */
const noThreads =
  noRust ??
  (!threadsFile
    ? 'no threads build; run node scripts/build-wasm.mjs --threads (nightly Rust)'
    : !createSharedMemory()
      ? 'this runtime cannot create a shared WebAssembly memory'
      : null);

const it = itUnless(noRust);
const itThreads = itUnless(noThreads);

/** Seconds of the bit-identity render (the issue asks for 0.2 s). */
const SECONDS = 0.2;

/** The first `seconds` of 'Hello.' (seed 1, tier high) on `engine`. */
function renderOn(engine, options, seconds) {
  const { plan, renderOptions } = prepareUtterance('Hello.', {
    tier: 'high',
    seed: 1,
  });
  const renderer = new RustVoiceRenderer(engine, plan, {
    ...renderOptions,
    ...options,
  });
  try {
    const samples = new Float32Array(Math.round(seconds * renderer.sampleRate));
    expect(renderer.render(samples)).toBe(samples.length);
    return { samples, threads: renderer.threads, engine: engine.threads };
  } finally {
    renderer.free();
  }
}

/** renderOn on a new engine of `threads`. */
async function renderHello(threads, options, seconds) {
  const engine = await loadEngineModule(undefined, { threads });
  try {
    return renderOn(engine, options, seconds);
  } finally {
    engine.close();
  }
}

/** The room of the bit-identity render; a team for any grid size. */
const ROOM = Object.freeze({
  enclosure: { width: 40, height: 40, depth: 40 },
  threadMinLinks: 0,
});

let reference;

/** The bit-identity render on one thread, shared by the tests. */
function oneThread() {
  reference ??= renderHello(1, ROOM, SECONDS);
  return reference;
}

/** Index of the first sample that is not the same bits, or -1. */
function firstDifference(actual, expected) {
  if (actual.length !== expected.length) {
    return Math.min(actual.length, expected.length);
  }
  return expected.findIndex((value, index) => !(actual[index] === value));
}

/** Whether `globalThis.crossOriginIsolated` is `value` during `action`. */
async function withIsolation(value, action) {
  const before = Object.getOwnPropertyDescriptor(
    globalThis,
    'crossOriginIsolated'
  );
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value,
    configurable: true,
    writable: true,
  });
  try {
    return await action();
  } finally {
    if (before) {
      Object.defineProperty(globalThis, 'crossOriginIsolated', before);
    } else {
      delete globalThis.crossOriginIsolated;
    }
  }
}

describe('the 3D solver on several threads (issue 24)', () => {
  it('one thread is the default', async () => {
    expect(requestedThreads()).toBe(1);
    expect(requestedThreads(3)).toBe(3);
    const auto = requestedThreads('auto');
    expect(auto >= 1 && auto <= AUTO_THREADS_MAX).toBe(true);
    for (const bad of [0, -1, 2.5, '4', null, true]) {
      expect(() => requestedThreads(bad)).toThrow();
    }
    const engine = await loadEngineModule();
    try {
      expect(engine.threads).toBe(1);
      expect(engine.pool).toBe(null);
    } finally {
      engine.close();
    }
  });

  it('falls back without isolation', async () => {
    await withIsolation(false, async () => {
      expect(createSharedMemory()).toBe(null);
      const engine = await loadEngineModule(undefined, { threads: 4 });
      try {
        expect(engine.threads).toBe(1);
        expect(engine.pool).toBe(null);
        const { samples, threads } = renderOn(engine, {}, 0.1);
        expect(threads).toBe(1);
        expect(samples.some((value) => Math.abs(value) > 0.001)).toBe(true);
      } finally {
        engine.close();
      }
    });
  });

  itThreads('threaded render is bit-identical: one thread', async () => {
    const { samples, threads, engine } = await oneThread();
    expect(engine).toBe(1);
    expect(threads).toBe(1);
    expect(samples.length).toBe(9600);
    expect(samples.some((value) => Math.abs(value) > 0.001)).toBe(true);
  });

  for (const count of [2, 4]) {
    itThreads(
      `threaded render is bit-identical: ${count} threads`,
      async () => {
        const expected = (await oneThread()).samples;
        const { samples, threads, engine } = await renderHello(
          count,
          ROOM,
          SECONDS
        );
        expect(engine).toBe(count);
        expect(threads).toBe(count);
        expect(firstDifference(samples, expected)).toBe(-1);
      }
    );
  }

  itThreads('createEngine passes threads and simd on', async () => {
    const loaded = await loadEngineModule(undefined, { threads: 2 });
    const { simd } = loaded;
    loaded.close();
    const engine = await createEngine({ engine: 'rust', threads: 2, simd });
    try {
      expect(engine.name).toBe('rust');
      expect(engine.threads).toBe(2);
      expect(engine.simd).toBe(simd);
      expect(engine.module.pool.size).toBe(2);
      const { plan, renderOptions } = prepareUtterance('Hello.', {
        tier: 'high',
        seed: 1,
      });
      const renderer = engine.createRenderer(plan, {
        ...renderOptions,
        threadMinLinks: 0,
      });
      try {
        expect(renderer.engine).toBe('rust');
        const samples = new Float32Array(480);
        expect(renderer.render(samples)).toBe(samples.length);
        expect(renderer.threads).toBe(2);
      } finally {
        renderer.free();
      }
    } finally {
      engine.close();
    }
    expect(engine.module).toBe(null);
    // The synchronous load has no helpers, so it is not cached for 2.
    const sync = getEngine({ engine: 'rust', threads: 2, simd });
    expect(sync.threads).toBe(1);
    expect(getEngine({ engine: 'rust', threads: 2, simd }) === sync).toBe(
      false
    );
  });

  itThreads('small grids stay on one thread', async () => {
    // THREAD_MIN_LINKS of the engine: the grid of tier `high` without a
    // room is below it.
    const { threads, engine } = await renderHello(4, {}, 0.02);
    expect(engine).toBe(4);
    expect(threads).toBe(1);
  });
});
