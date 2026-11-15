/**
 * The Rust engine gives the same numbers as the JavaScript reference
 * (docs/RUST-ENGINE.md). The random generator is parity class
 * A, so every value must be bit-identical (`Object.is`).
 *
 * Skipped with a visible reason when src/engine/voice-simulator.wasm has
 * not been built; CI builds it and runs this file with REQUIRE_WASM=1.
 */

import { describe, expect } from 'test-anywhere';

import { createRandom, hashSeed, randomNormal } from '../src/random.js';
import { float64View, uint16View } from '../src/engine/wasm-loader.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const it = itUnless(noRust);

const SEEDS = [0, 1, 42, 0xffffffff, hashSeed('voice')];
const COUNT = 10000;

/**
 * Run `fill(seed, pointer, count)` into a fresh block and copy it out.
 * @returns {Float64Array}
 */
function engineValues(engine, fill, seed, count) {
  const { vs_alloc: alloc, vs_free: free } = engine.exports;
  const bytes = count * 8;
  const pointer = alloc(bytes);
  expect(pointer).not.toBe(0);
  try {
    expect(fill(seed, pointer, count)).toBe(0);
    // A view made after the last call that could allocate.
    return float64View(engine, pointer, count).slice();
  } finally {
    free(pointer, bytes);
  }
}

/** Index of the first value that is not `Object.is` its expectation, or -1. */
function firstMismatch(actual, expected) {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index++) {
    if (!Object.is(actual[index], expected[index])) {
      return index;
    }
  }
  return -1;
}

function hashInEngine(engine, text) {
  const { vs_alloc: alloc, vs_free: free } = engine.exports;
  const bytes = Math.max(text.length * 2, 1);
  const pointer = alloc(bytes);
  try {
    const units = uint16View(engine, pointer, text.length);
    for (let index = 0; index < text.length; index++) {
      units[index] = text.charCodeAt(index);
    }
    return engine.exports.vs_hash_seed_utf16(pointer, text.length);
  } finally {
    free(pointer, bytes);
  }
}

describe('Rust engine parity', () => {
  it('reports interface version 1', async () => {
    const engine = await loadRustEngine();
    expect(engine.abiVersion).toBe(1);
    expect(engine.memory instanceof globalThis.WebAssembly.Memory).toBe(true);
  });

  it('hashes seeds like JavaScript', async () => {
    const engine = await loadRustEngine();
    for (const text of ['', 'a', 'voice', 'héllo', '你好', '😀']) {
      expect(hashInEngine(engine, text) >>> 0).toBe(hashSeed(text));
    }
  });

  it('uniform numbers are bit-identical', async () => {
    const engine = await loadRustEngine();
    for (const seed of SEEDS) {
      const random = createRandom(seed);
      const expected = Float64Array.from({ length: COUNT }, () => random());
      const actual = engineValues(
        engine,
        engine.exports.vs_random_fill,
        seed,
        COUNT
      );
      expect(firstMismatch(actual, expected)).toBe(-1);
    }
  });

  it('normal numbers are bit-identical', async () => {
    const engine = await loadRustEngine();
    for (const seed of SEEDS) {
      const random = createRandom(seed);
      const expected = Float64Array.from({ length: COUNT }, () =>
        randomNormal(random)
      );
      const actual = engineValues(
        engine,
        engine.exports.vs_random_normal_fill,
        seed,
        COUNT
      );
      expect(firstMismatch(actual, expected)).toBe(-1);
    }
  });

  it('views survive growth', async () => {
    const engine = await loadRustEngine();
    const { vs_alloc: alloc, vs_free: free } = engine.exports;
    const before = engine.memory.buffer;
    const big = alloc(70000000);
    expect(big).not.toBe(0);
    expect(big % 8).toBe(0);
    const count = 1000;
    const pointer = alloc(count * 8);
    try {
      expect(engine.exports.vs_random_fill(7, pointer, count)).toBe(0);
      const values = float64View(engine, pointer, count);
      const random = createRandom(7);
      const expected = Float64Array.from({ length: count }, () => random());
      expect(firstMismatch(values, expected)).toBe(-1);
      // The growth replaced the buffer the engine started with.
      expect(engine.memory.buffer).not.toBe(before);
      expect(engine.memory.buffer.byteLength >= 70000000).toBe(true);
    } finally {
      free(pointer, count * 8);
      free(big, 70000000);
    }
  });

  it('reports bad ranges with negative codes', async () => {
    const engine = await loadRustEngine();
    const fill = engine.exports.vs_random_fill;
    expect(fill(1, 0, 0)).toBe(0);
    expect(fill(1, 0, 4)).toBe(-1);
    expect(fill(1, 12, 4)).toBe(-2);
    expect(fill(1, engine.memory.buffer.byteLength - 8, 2)).toBe(-3);
  });
});
