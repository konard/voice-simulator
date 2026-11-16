/**
 * The Rust engine gives the same numbers as the JavaScript reference
 * (docs/RUST-ENGINE.md). The random generator is parity class
 * A, so every value must be bit-identical (`Object.is`). The resampler of
 * src/audio/resample.js is class B (it calls `sin` and `cos`): its relative
 * RMS error against JavaScript must stay at most `RESAMPLE_LIMIT`.
 *
 * Skipped with a visible reason when src/engine/voice-simulator.wasm has
 * not been built; CI builds it and runs this file with REQUIRE_WASM=1.
 */

import { describe, expect } from 'test-anywhere';

import { createRandom, hashSeed, randomNormal } from '../src/random.js';
import {
  Aerodynamics,
  GLOTTIS_BREATHY,
  GLOTTIS_OPEN,
  GLOTTIS_VOICED,
  RE_CRITICAL,
  glottalArea,
  openTractStrength,
  reynolds,
  sourceStrength,
  steadyFlow,
} from '../src/acoustics/aerodynamics.js';
import { STROUHAL, strouhalFrequency } from '../src/acoustics/voice.js';
import { createStreamResampler, resample } from '../src/audio/resample.js';
import {
  float32View,
  float64View,
  uint16View,
} from '../src/engine/wasm-loader.js';
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

/** Class B limit of the resampler (issue 27): relative RMS error. */
const RESAMPLE_LIMIT = 1e-6;

/** The rate pairs of the player (TTS rates to device rates) and back. */
const RATE_PAIRS = [
  [16000, 44100],
  [16000, 48000],
  [22050, 48000],
  [24000, 44100],
  [48000, 44100],
  [44100, 16000],
];

/** `seconds` of two tones and seeded noise at `rate`. */
function testSignal(rate, seconds = 0.5) {
  const random = createRandom(`issue-27-${rate}`);
  return Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, index) =>
      0.4 * Math.sin((2 * Math.PI * 440 * index) / rate) +
      0.2 * Math.sin((2 * Math.PI * 3100 * index) / rate) +
      0.2 * (random() - 0.5)
  );
}

/** `sqrt(sum((a - e)^2) / sum(e^2))`, the class B measure. */
function relativeRms(actual, expected) {
  expect(actual.length).toBe(expected.length);
  let error = 0;
  let energy = 0;
  for (let index = 0; index < expected.length; index++) {
    error += (actual[index] - expected[index]) ** 2;
    energy += expected[index] ** 2;
  }
  return Math.sqrt(error / energy);
}

/** Copy `samples` into a fresh block; returns its pointer and byte size. */
function writeSamples(engine, samples) {
  const bytes = Math.max(samples.length * 4, 1);
  const pointer = engine.exports.vs_alloc(bytes);
  expect(pointer).not.toBe(0);
  float32View(engine, pointer, samples.length).set(samples);
  return { pointer, bytes };
}

/** `resample` in the engine. */
function engineResample(engine, samples, from, to, zeroCrossings) {
  const { vs_free: free, vs_resample_length: lengthOf } = engine.exports;
  const length = lengthOf(samples.length, from, to);
  expect(length).toBe(Math.round((samples.length * to) / from));
  const input = writeSamples(engine, samples);
  const output = writeSamples(engine, new Float32Array(length));
  try {
    const code = engine.exports.vs_resample(
      input.pointer,
      samples.length,
      from,
      to,
      zeroCrossings,
      output.pointer,
      length
    );
    expect(code).toBe(0);
    return float32View(engine, output.pointer, length).slice();
  } finally {
    free(input.pointer, input.bytes);
    free(output.pointer, output.bytes);
  }
}

/** Take the waiting outputs of resampler `handle` (`ready` of them). */
function engineRead(engine, handle, ready) {
  expect(ready >= 0).toBe(true);
  const output = writeSamples(engine, new Float32Array(ready));
  try {
    expect(
      engine.exports.vs_resampler_read(handle, output.pointer, ready)
    ).toBe(ready);
    return float32View(engine, output.pointer, ready).slice();
  } finally {
    engine.exports.vs_free(output.pointer, output.bytes);
  }
}

/** Chunk sizes from 1 to 2000 samples, seeded. */
function chunkSizes(total, seed) {
  const random = createRandom(seed);
  const sizes = [];
  for (let used = 0; used < total; ) {
    const size = Math.min(total - used, 1 + Math.floor(random() * 2000));
    sizes.push(size);
    used += size;
  }
  return sizes;
}

function join(parts) {
  const result = new Float32Array(
    parts.reduce((sum, part) => sum + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

describe('Rust engine parity', () => {
  it('reports interface version 4', async () => {
    const engine = await loadRustEngine();
    expect(engine.abiVersion).toBe(4);
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

  it('resamples whole buffers like JavaScript (class B)', async () => {
    const engine = await loadRustEngine();
    let worst = 0;
    for (const [from, to] of RATE_PAIRS) {
      const input = testSignal(from);
      for (const zeroCrossings of [8, 16]) {
        const expected = resample(input, from, to, { zeroCrossings });
        const actual = engineResample(engine, input, from, to, zeroCrossings);
        worst = Math.max(worst, relativeRms(actual, expected));
      }
    }
    expect(worst <= RESAMPLE_LIMIT).toBe(true);
    // Equal rates copy the samples.
    const same = testSignal(8000, 0.01);
    expect(
      firstMismatch(engineResample(engine, same, 8000, 8000, 16), same)
    ).toBe(-1);
  });

  it('stream resamplers match createStreamResampler (class B)', async () => {
    const engine = await loadRustEngine();
    const { exports } = engine;
    let worst = 0;
    for (const [from, to] of RATE_PAIRS) {
      const input = testSignal(from);
      const reference = createStreamResampler(from, to);
      const handle = exports.vs_resampler_new(from, to, 8);
      expect(handle > 0).toBe(true);
      const expectedParts = [];
      const actualParts = [];
      try {
        let start = 0;
        for (const size of chunkSizes(input.length, `${from}-${to}`)) {
          const chunk = input.subarray(start, start + size);
          start += size;
          const expected = reference.push(chunk);
          const { pointer, bytes } = writeSamples(engine, chunk);
          const ready = exports.vs_resampler_push(handle, pointer, size);
          exports.vs_free(pointer, bytes);
          // The same outputs are ready after every chunk.
          expect(ready).toBe(expected.length);
          expect(exports.vs_resampler_held(handle)).toBe(reference.held());
          expectedParts.push(expected);
          actualParts.push(engineRead(engine, handle, ready));
        }
        const expected = reference.flush();
        const ready = exports.vs_resampler_flush(handle);
        expect(ready).toBe(expected.length);
        expectedParts.push(expected);
        actualParts.push(engineRead(engine, handle, ready));
      } finally {
        expect(exports.vs_resampler_free(handle)).toBe(0);
      }
      worst = Math.max(
        worst,
        relativeRms(join(actualParts), join(expectedParts))
      );
    }
    expect(worst <= RESAMPLE_LIMIT).toBe(true);
  });

  it('reports bad resampler arguments and handles', async () => {
    const { exports } = await loadRustEngine();
    expect(exports.vs_resample_length(10, 0, 48000)).toBe(-6);
    expect(exports.vs_resampler_new(16000, Number.NaN, 8)).toBe(-6);
    expect(exports.vs_resampler_new(16000, 48000, 0)).toBe(-6);
    expect(exports.vs_resample(0, 0, 16000, 48000, 16, 0, 1)).toBe(-6);
    const handle = exports.vs_resampler_new(16000, 48000, 8);
    expect(exports.vs_resampler_free(handle)).toBe(0);
    expect(exports.vs_resampler_free(handle)).toBe(-5);
    expect(exports.vs_resampler_push(handle, 0, 0)).toBe(-5);
    expect(exports.vs_resampler_read(0, 0, 0)).toBe(-5);
  });
});

/**
 * Inputs of the air flow functions: a seeded grid over the ranges the
 * renderer uses (pressures up to 20000 dyn/cm², areas up to 3 cm², flows
 * up to 2000 cm³/s), plus the edges 0 and negative values.
 */
function airflowInputs(count) {
  const random = createRandom('aerodynamics');
  const rows = [
    [0, 0, 0],
    [8000, 0.25, 0.09],
    [-1, 0.1, 100],
    [7034, 0.09, 316],
  ];
  while (rows.length < count) {
    rows.push([20000 * random(), 3 * random() ** 2, 2000 * random()]);
  }
  return rows;
}

describe('Rust engine parity: aerodynamics (issue 35)', () => {
  it('turbulence strengths are bit-identical (class A)', async () => {
    const { exports } = await loadRustEngine();
    // Every other row takes the head's own reCritical and strouhal (issue
    // 41) inside their ranges; the others the defaults.
    const random = createRandom('turbulence-head');
    for (const [index, [pressure, area, flow]] of airflowInputs(
      5000
    ).entries()) {
      const custom = index % 2 === 1;
      const reCritical = custom ? 1700 + 600 * random() : RE_CRITICAL;
      const strouhal = custom ? 0.15 + 0.15 * random() : STROUHAL;
      expect(exports.vs_aero_reynolds(flow, area)).toBe(reynolds(flow, area));
      expect(
        Object.is(
          exports.vs_aero_source_strength(pressure, area, flow, reCritical),
          custom
            ? sourceStrength(pressure, area, flow, reCritical)
            : sourceStrength(pressure, area, flow)
        )
      ).toBe(true);
      expect(
        Object.is(
          exports.vs_aero_open_tract_strength(pressure, area, reCritical),
          custom
            ? openTractStrength(pressure, area, reCritical)
            : openTractStrength(pressure, area)
        )
      ).toBe(true);
      expect(
        Object.is(
          exports.vs_aero_strouhal_frequency(flow, area, strouhal),
          custom
            ? strouhalFrequency(flow, area, strouhal)
            : strouhalFrequency(flow, area)
        )
      ).toBe(true);
    }
  });

  it('glottal areas are bit-identical (class A)', async () => {
    const { exports } = await loadRustEngine();
    const random = createRandom('glottal-area');
    for (let index = 0; index < 2000; index++) {
      const control = {
        voicing: 1.2 * random() - 0.1,
        aspiration: 1.2 * random() - 0.1,
        closure: 1.2 * random() - 0.1,
      };
      const breathiness = random();
      const chink = 20 * random() - 1;
      // Odd rows take a head's own glottal areas (issue 41).
      const areas =
        index % 2 === 1
          ? {
              glottisVoiced: 0.03 + 0.07 * random(),
              glottisOpen: 0.15 + 0.25 * random(),
              glottisBreathy: 0.05 + 0.15 * random(),
            }
          : {};
      expect(
        Object.is(
          exports.vs_aero_glottal_area(
            control.voicing,
            control.aspiration,
            control.closure,
            breathiness,
            chink,
            areas.glottisVoiced ?? GLOTTIS_VOICED,
            areas.glottisOpen ?? GLOTTIS_OPEN,
            areas.glottisBreathy ?? GLOTTIS_BREATHY
          ),
          glottalArea(control, breathiness, chink, areas)
        )
      ).toBe(true);
    }
  });

  it('steady flows are bit-identical (class A)', async () => {
    const engine = await loadRustEngine();
    const { vs_alloc: alloc, vs_free: free } = engine.exports;
    const pointer = alloc(16);
    try {
      for (const [pressure, glottis, constriction] of airflowInputs(2000)) {
        expect(
          engine.exports.vs_aero_steady_flow(
            pressure,
            glottis,
            constriction / 1000,
            pointer
          )
        ).toBe(0);
        const [oral, flow] = float64View(engine, pointer, 2);
        const expected = steadyFlow(pressure, glottis, constriction / 1000);
        expect(Object.is(oral, expected.oralPressure)).toBe(true);
        expect(Object.is(flow, expected.flow)).toBe(true);
      }
    } finally {
      free(pointer, 16);
    }
  });

  it('the mouth pressure is bit-identical (class A)', async () => {
    const engine = await loadRustEngine();
    const { vs_alloc: alloc, vs_free: free } = engine.exports;
    // A closure and release at 48 kHz: lung pressure ramps up, the
    // constriction closes for 50 ms and opens again, the glottis opens.
    const count = 9600;
    const dt = 1 / 48000;
    const inputs = Array.from({ length: count }, (_, index) => {
      const time = index * dt;
      const closed = time > 0.05 && time < 0.1;
      return [
        Math.min(8000, time * 160000),
        0.05 + 0.2 * Math.min(1, Math.max(0, (time - 0.04) / 0.05)),
        closed ? 0 : 0.09 + 0.5 * Math.max(0, time - 0.1),
      ];
    });
    const bytes = count * 5 * 8;
    const pointer = alloc(bytes);
    try {
      const steps = float64View(engine, pointer, count * 5);
      inputs.forEach((row, index) => steps.set(row, index * 5));
      expect(engine.exports.vs_aero_run(dt, 1e-3, pointer, count)).toBe(0);
      const actual = float64View(engine, pointer, count * 5);
      const air = new Aerodynamics();
      let different = 0;
      inputs.forEach(([lung, glottis, constriction], index) => {
        const state = air.step(dt, lung, glottis, constriction);
        const expected = [
          state.flow,
          state.flowDerivative,
          state.oralPressure,
          state.glottalDrop,
          state.constrictionDrop,
        ];
        expected.forEach((value, offset) => {
          if (!Object.is(actual[index * 5 + offset], value)) {
            different++;
          }
        });
      });
      expect(different).toBe(0);
    } finally {
      free(pointer, bytes);
    }
  });

  it('rejects a bad airflow buffer', async () => {
    const { exports } = await loadRustEngine();
    expect(exports.vs_aero_run(0, 1e-3, 0, 1)).toBe(-1);
    expect(exports.vs_aero_run(0, 1e-3, 12, 1)).toBe(-2);
    expect(exports.vs_aero_steady_flow(1, 1, 1, 0)).toBe(-1);
  });
});
