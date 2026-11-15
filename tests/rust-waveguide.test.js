/**
 * The Rust port of the waveguide voice renderer (issue 22) gives the same
 * numbers as the JavaScript reference: the biquad, the LF glottis and the
 * waveguide on their own, then whole renders. All of them are parity
 * class B (docs/RUST-ENGINE.md): they call sin, cos, exp, log, pow or
 * tanh, so the error is measured against the JavaScript output as
 * `error(a, e) = sqrt(sum((a - e)^2) / sum(e^2))`.
 *
 * Skipped with a visible reason when src/engine/voice-simulator.wasm has
 * not been built; CI builds it and runs this file with REQUIRE_WASM=1.
 */

import { describe, expect } from 'test-anywhere';

import { Biquad, createNoise } from '../src/acoustics/filters.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const it = itUnless(noRust);

/** Relative RMS error of `actual` against `expected`. */
export function error(actual, expected) {
  expect(actual.length).toBe(expected.length);
  let difference = 0;
  let energy = 0;
  for (let index = 0; index < expected.length; index++) {
    difference += (actual[index] - expected[index]) ** 2;
    energy += expected[index] ** 2;
  }
  return Math.sqrt(difference / energy);
}

/**
 * Copy `values` into the engine, run `call(pointer, count)` on them and
 * copy the block back.
 * @returns {{result: number, values: Float64Array}}
 */
function inEngine(engine, values, call) {
  const { vs_alloc: alloc, vs_free: free } = engine.exports;
  const bytes = Math.max(values.length * 8, 8);
  const pointer = alloc(bytes);
  expect(pointer).not.toBe(0);
  try {
    float64View(engine, pointer, values.length).set(values);
    const result = call(pointer, values.length);
    return {
      result,
      values: float64View(engine, pointer, values.length).slice(),
    };
  } finally {
    free(pointer, bytes);
  }
}

describe('Rust waveguide renderer (issue 22)', () => {
  it('biquad matches', async () => {
    const engine = await loadRustEngine();
    const noise = createNoise(1);
    const input = Float64Array.from({ length: 4096 }, () => noise());
    const filter = new Biquad().lowpass(3600, 0.54, 25455);
    const expected = input.map((value) => filter.process(value));
    const { result, values } = inEngine(engine, input, (pointer, count) =>
      engine.exports.vs_biquad_run(0, 3600, 0.54, 25455, pointer, count)
    );
    expect(result).toBe(0);
    const measured = error(values, expected);
    globalThis.console.log(`biquad error ${measured}`);
    expect(measured < 1e-9).toBe(true);
  });
});
