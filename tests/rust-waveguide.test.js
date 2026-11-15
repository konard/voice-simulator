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
import { Glottis } from '../src/acoustics/glottis.js';
import { Radiation } from '../src/acoustics/radiation.js';
import { piriformBranch, Waveguide } from '../src/acoustics/waveguide.js';
import { noseShape } from '../src/articulation/tract-shape.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { hashSeed } from '../src/random.js';
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

  it('glottis matches', async () => {
    const engine = await loadRustEngine();
    const dt = 1 / 46667;
    const count = Math.round(0.5 / dt);
    const control = {
      f0: 120,
      voicing: 1,
      aspiration: 0.1,
      closure: 0,
      loudness: 1,
    };
    const noise = createNoise(2);
    const input = Float64Array.from({ length: count }, () => noise());
    const glottis = new Glottis({ seed: 1 });
    let periods = 0;
    const expected = input.map((value) => {
      const previous = glottis.phase;
      const sample = glottis.step(dt, control, value);
      if (glottis.phase < previous) {
        periods++;
      }
      return sample;
    });
    const parameters = [
      glottis.tenseness,
      glottis.breathiness,
      100 * glottis.jitterDepth,
      100 * glottis.shimmerDepth,
      glottis.aspirationLevel,
      glottis.chink,
      glottis.lungPressure,
      dt,
      control.f0,
      control.voicing,
      control.aspiration,
      control.closure,
      control.loudness,
    ];
    const { values } = inEngine(engine, input, (pointer, length) =>
      inEngine(engine, parameters, (params) => {
        const result = engine.exports.vs_glottis_run(
          hashSeed('1:glottis'),
          params,
          pointer,
          length
        );
        expect(result).toBe(periods);
        return result;
      })
    );
    const measured = error(values, expected);
    globalThis.console.log(`glottis error ${measured}, ${periods} periods`);
    expect(measured < 1e-6).toBe(true);
  });

  it('radiation matches', async () => {
    const engine = await loadRustEngine();
    const rate = (22 * 35000) / 16.5;
    const noise = createNoise(3);
    const input = Float64Array.from({ length: 4096 }, () => noise());
    const radiation = new Radiation();
    radiation.configure(3, rate);
    const expected = input.map((value) => radiation.process(value));
    const { result, values } = inEngine(engine, input, (pointer, count) =>
      engine.exports.vs_radiation_run(3, rate, pointer, count)
    );
    expect(result).toBe(0);
    const measured = error(values, expected);
    globalThis.console.log(`radiation error ${measured}`);
    expect(measured).toBe(0);
  });
  it('waveguide matches', async () => {
    const engine = await loadRustEngine();
    const sections = 22;
    const noseSections = 14;
    const head = { ...DEFAULT_HEAD, glottalChink: 2 };
    const areas = Array.from({ length: sections }, (_, index) =>
      index >= 14 && index <= 16 ? 0.3 : 3
    );
    const nose = noseShape(head).areas;
    const velumArea = 0.4;
    const velumIndex = 10;
    const waveguide = new Waveguide({ sections, noseSections, head });
    waveguide.setNose(nose);
    waveguide.setShape(areas, velumArea, velumIndex);
    const input = new Float64Array(4096);
    input[0] = 1;
    const expected = input.map((value) => waveguide.step(value, 1, 0, 0));
    const branch = piriformBranch(sections, 16.5, head);
    const parameters = [
      sections,
      noseSections,
      head.wallLoss,
      head.nasalLoss,
      head.glottalChink,
      head.vocalTractLength,
      branch.index,
      branch.area,
      branch.sections,
      velumArea,
      velumIndex,
      ...areas,
      ...nose,
    ];
    const { values } = inEngine(engine, input, (pointer, length) =>
      inEngine(engine, parameters, (params, count) => {
        const result = engine.exports.vs_waveguide_run(
          params,
          count,
          pointer,
          length
        );
        expect(result).toBe(0);
        return result;
      })
    );
    const measured = error(values, expected);
    globalThis.console.log(`waveguide error ${measured}`);
    expect(measured < 1e-9).toBe(true);
  });
});
