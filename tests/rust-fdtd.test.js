/**
 * The 3D FDTD solver in Rust (issue 23) against the JavaScript Fdtd3d:
 * the kernel bit for bit, in both forms and in the SIMD build; the packed
 * voxel model; the solver; whole renders; and the loader's fallback from
 * the SIMD file to the scalar one.
 *
 * Skipped without src/engine/voice-simulator.wasm (see
 * ./helpers/rust-engine.js); REQUIRE_WASM=1 turns that into an error. The
 * SIMD test also needs the SIMD build (`npm run build:wasm` leaves it under
 * target/simd) and is skipped with a reason when the runtime rejects it.
 *
 * The kernel tests set the nose and the shape of `a` before copying the
 * coefficients: the coefficients the Fdtd3d constructor leaves are not
 * the ones of any shape (a conductance of 1 next to the sinus cells of
 * fill 1/12 makes the field grow to Infinity within 2000 steps), and
 * every render calls setShape before its first step anyway.
 */

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect } from 'test-anywhere';

import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { renderPlan, VoiceRenderer } from '../src/acoustics/voice.js';
import {
  buildVoxelModel,
  voxelModelOptions,
} from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { frameStride, writeFrame } from '../src/engine/layout.js';
import {
  fdtdListening,
  modelArrays,
  modelHeader,
  packVoxelModel,
} from '../src/engine/pack-model.js';
import { RustVoiceRenderer } from '../src/engine/rust-renderer.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { prepareUtterance } from '../src/synthesize.js';
import {
  loadRustEngine,
  loadSimdEngine,
  noRust,
  simdEngineUrl,
} from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const it = itUnless(noRust);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEPS = 2000;
/** Indices of vs_fdtd_kernel_array (crates/voice-simulator-wasm/src/fdtd.rs). */
const KERNEL = Object.freeze({
  LINK_A: 0,
  LINK_B: 1,
  VELOCITY: 2,
  DAMPING: 3,
  CONDUCTANCE: 4,
  PRESSURE: 6,
  KEEP: 8,
  GAIN: 9,
});
/** Samples of the render in a room: 50 ms at 48 kHz. */
const ENCLOSURE_SAMPLES = 2400;
/** Values of the options of vs_fdtd_solver_new. */
const SOLVER_OPTIONS = 9;

/** Why the SIMD test cannot run, or null; decided before registering it. */
async function simdProblem() {
  if (noRust) {
    return noRust;
  }
  if (!simdEngineUrl) {
    return 'no SIMD build; run npm run build:wasm';
  }
  return (await loadSimdEngine())
    ? null
    : 'the runtime rejects WebAssembly SIMD (voice-simulator-simd.wasm)';
}
const noSimd = await simdProblem();

/** `vowelShape` of tests/fdtd3d.test.js: the target of a vowel, not rhotic. */
function vowelShape(symbol) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
}

/** The JavaScript solver of the test, with the shape of `a`. */
function javascriptSolver() {
  const solver = new Fdtd3d({
    model: buildVoxelModel(DEFAULT_HEAD, { dx: 1 }),
    kernel: 'js',
  });
  const shape = vowelShape('a');
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  return solver;
}

/** Copy the coefficients of `solver` into a new Rust kernel. */
function rustKernel(engine, solver) {
  const { exports } = engine;
  const handle = exports.vs_fdtd_kernel_new(solver.linkCount, solver.cellCount);
  expect(handle > 0).toBe(true);
  const view = (which, Type, count) =>
    new Type(
      engine.memory.buffer,
      exports.vs_fdtd_kernel_array(handle, which),
      count
    );
  const links = solver.linkCount;
  const cells = solver.cellCount;
  return {
    handle,
    copy() {
      view(KERNEL.LINK_A, Uint32Array, links).set(solver.linkA);
      view(KERNEL.LINK_B, Uint32Array, links).set(solver.linkB);
      view(KERNEL.DAMPING, Float64Array, links).set(solver.damping);
      view(KERNEL.CONDUCTANCE, Float64Array, links).set(solver.conductance);
      view(KERNEL.KEEP, Float64Array, cells).set(solver.keep);
      view(KERNEL.GAIN, Float64Array, cells).set(solver.gain);
    },
    pressure: () => view(KERNEL.PRESSURE, Float64Array, cells),
    velocity: () => view(KERNEL.VELOCITY, Float64Array, links),
    free: () => exports.vs_fdtd_kernel_free(handle),
  };
}

/** The pressure and velocity after STEPS steps of a Rust kernel. */
function runKernel(engine, solver, gather) {
  const kernel = rustKernel(engine, solver);
  try {
    kernel.copy();
    kernel.pressure()[0] = 1;
    expect(
      engine.exports.vs_fdtd_kernel_steps(kernel.handle, STEPS, gather)
    ).toBe(0);
    return {
      pressure: kernel.pressure().slice(),
      velocity: kernel.velocity().slice(),
    };
  } finally {
    kernel.free();
  }
}

/** How many values differ under `===` or are not finite. */
function mismatches(actual, expected) {
  expect(actual.length).toBe(expected.length);
  let count = 0;
  for (let index = 0; index < expected.length; index++) {
    if (
      !(actual[index] === expected[index] && Number.isFinite(actual[index]))
    ) {
      count++;
    }
  }
  return count;
}

/** Copy `bytes` into fresh engine memory; `engineFloats` copies f64 values. */
function engineBytes(engine, bytes) {
  const pointer = engine.exports.vs_alloc(Math.max(8, bytes.length));
  expect(pointer).not.toBe(0);
  new Uint8Array(engine.memory.buffer, pointer, bytes.length).set(bytes);
  return { pointer, size: Math.max(8, bytes.length) };
}

function engineFloats(engine, values) {
  return engineBytes(engine, new Uint8Array(Float64Array.from(values).buffer));
}

function release(engine, ...blocks) {
  for (const { pointer, size } of blocks) {
    engine.exports.vs_free(pointer, size);
  }
}

/** The first and last element of every section of a packed model. */
function sectionEnds(buffer, arrays) {
  const view = new DataView(buffer);
  const align = (offset) => Math.ceil(offset / 8) * 8;
  let offset = align(4 * 12);
  return arrays.map(([type, values]) => {
    const size = type === 'f64' ? 8 : 4;
    const read = (index) =>
      type === 'f64'
        ? view.getFloat64(offset + 8 * index, true)
        : view.getInt32(offset + 4 * index, true);
    const ends =
      values.length === 0
        ? []
        : [read(0), read(values.length - 1), values.length];
    offset = align(offset + size * values.length);
    return ends;
  });
}

/** The voxel model of tier `high` (dx 1 cm, as VoiceRenderer builds it). */
let cachedModel;
function tierModel() {
  cachedModel ??= buildVoxelModel(DEFAULT_HEAD, {
    dx: 1,
    ...voxelModelOptions({ head: DEFAULT_HEAD, dx: 1 }),
  });
  return cachedModel;
}

/**
 * Pack `model`, unpack and pack it again in Rust (vs_fdtd_model_repack)
 * and compare the counts, the first and last element and the length of
 * every section, and then every byte.
 */
function checkRepack(engine, model) {
  const packed = new Uint8Array(packVoxelModel(model));
  const input = engineBytes(engine, packed);
  const capacity = packed.length / 8 + 64;
  const output = engineFloats(engine, new Float64Array(capacity));
  try {
    const length = engine.exports.vs_fdtd_model_repack(
      input.pointer,
      packed.length,
      output.pointer,
      capacity
    );
    expect(length).toBe(packed.length);
    const repacked = float64View(engine, output.pointer, length / 8).slice()
      .buffer;
    const { header, arrays } = modelArrays(model);
    const counts = modelHeader(repacked);
    expect(counts.CELLS).toBe(header.cells);
    expect(counts.LINKS).toBe(header.links);
    expect(counts.SINUSES).toBe(header.sinuses);
    expect(counts.TEETH_CELLS).toBe(header.teethCells);
    expect(counts.OPENING_ROWS).toBe(header.rows);
    expect(counts.FLAGS).toBe(header.flags);
    const ends = sectionEnds(repacked, arrays);
    arrays.forEach(([, values], index) => {
      const expected =
        values.length === 0
          ? []
          : [values[0], values[values.length - 1], values.length];
      expect(ends[index]).toEqual(expected);
    });
    expect(mismatches(new Uint8Array(repacked), packed)).toBe(0);
  } finally {
    release(engine, input, output);
  }
}

/**
 * The outputs of STEPS steps of the Rust solver for `model` with the
 * shape `shape`, a unit flow impulse at step 0 and no noise.
 */
function rustSolverOutputs(engine, model, shape, nose) {
  const listening = fdtdListening(model);
  const options = new Float64Array(SOLVER_OPTIONS);
  options.set([
    listening.output === 'microphone' ? 1 : 0,
    listening.spherical ? 1 : 0,
    ...listening.target,
    DEFAULT_HEAD.wallLoss,
    DEFAULT_HEAD.nasalLoss,
    DEFAULT_HEAD.glottalChink,
    DEFAULT_HEAD.vocalTractLength,
  ]);
  const frame = new Float64Array(frameStride(shape.areas.length));
  writeFrame(frame, 0, shape, DEFAULT_HEAD.lungPressure);
  const inputs = new Float64Array(4 * STEPS);
  inputs[0] = 1;
  const packed = new Uint8Array(packVoxelModel(model));
  const blocks = {
    options: engineFloats(engine, options),
    model: engineBytes(engine, packed),
    nose: engineFloats(engine, nose),
    frame: engineFloats(engine, frame),
    inputs: engineFloats(engine, inputs),
    out: engineFloats(engine, new Float64Array(STEPS)),
  };
  const { exports } = engine;
  const handle = exports.vs_fdtd_solver_new(
    blocks.options.pointer,
    blocks.model.pointer,
    packed.length
  );
  try {
    expect(handle > 0).toBe(true);
    expect(
      exports.vs_fdtd_solver_set_nose(handle, blocks.nose.pointer, nose.length)
    ).toBe(0);
    expect(
      exports.vs_fdtd_solver_set_shape(
        handle,
        blocks.frame.pointer,
        frame.length
      )
    ).toBe(0);
    expect(
      exports.vs_fdtd_solver_steps(
        handle,
        blocks.inputs.pointer,
        STEPS,
        blocks.out.pointer
      )
    ).toBe(0);
    return float64View(engine, blocks.out.pointer, STEPS).slice();
  } finally {
    exports.vs_fdtd_solver_free(handle);
    release(engine, ...Object.values(blocks));
  }
}

/** Relative RMS difference sqrt(sum((a - e)^2) / sum(e^2)). */
function relativeRms(actual, expected) {
  let error = 0;
  let energy = 0;
  for (let index = 0; index < expected.length; index++) {
    error += (actual[index] - expected[index]) ** 2;
    energy += expected[index] ** 2;
  }
  return Math.sqrt(error / energy);
}

/** Largest absolute sample difference of `count` samples of 'Hello.'. */
function renderDifference(engine, options, count) {
  const { plan, renderOptions } = prepareUtterance('Hello.', {
    tier: 'high',
    seed: 1,
  });
  const settings = { ...renderOptions, ...options };
  let expected;
  if (count === undefined) {
    expected = renderPlan(plan, settings);
  } else {
    expected = new Float32Array(count);
    expect(new VoiceRenderer(plan, settings).render(expected)).toBe(count);
  }
  const actual = new Float32Array(expected.length);
  const rust = new RustVoiceRenderer(engine, plan, settings);
  try {
    expect(rust.render(actual)).toBe(actual.length);
  } finally {
    rust.free();
  }
  let difference = 0;
  let peak = 0;
  for (let index = 0; index < expected.length; index++) {
    difference = Math.max(
      difference,
      Math.abs(actual[index] - expected[index])
    );
    peak = Math.max(peak, Math.abs(expected[index]));
  }
  return { difference, peak, samples: expected.length };
}

describe('the 3D FDTD solver in Rust (issue 23)', () => {
  it('kernel is bit-identical with JavaScript', async () => {
    const engine = await loadRustEngine();
    const solver = javascriptSolver();
    const results = [0, 1].map((gather) => runKernel(engine, solver, gather));
    solver.pressure[0] = 1;
    for (let step = 0; step < STEPS; step++) {
      solver.step(0, 0, 0);
    }
    for (const result of results) {
      expect(mismatches(result.pressure, solver.pressure)).toBe(0);
      expect(mismatches(result.velocity, solver.velocity)).toBe(0);
    }
  });

  itUnless(noSimd)('SIMD is bit-identical with scalar', async () => {
    const scalar = await loadRustEngine();
    const simd = await loadSimdEngine();
    expect(scalar.simd).toBe(false);
    expect(simd.simd).toBe(true);
    const solver = javascriptSolver();
    for (const gather of [0, 1]) {
      const expected = runKernel(scalar, solver, gather);
      const actual = runKernel(simd, solver, gather);
      expect(mismatches(actual.pressure, expected.pressure)).toBe(0);
      expect(mismatches(actual.velocity, expected.velocity)).toBe(0);
    }
  });

  it('packs and unpacks a model', async () => {
    const engine = await loadRustEngine();
    for (const model of [
      tierModel(),
      buildVoxelModel(DEFAULT_HEAD, { dx: 1 }),
    ]) {
      checkRepack(engine, model);
    }
  });

  it('solver matches', async () => {
    const engine = await loadRustEngine();
    const model = tierModel();
    const shape = vowelShape('a');
    const nose = noseShape(DEFAULT_HEAD).areas;
    const js = new Fdtd3d({ model, head: DEFAULT_HEAD });
    js.setNose(nose);
    js.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
    const expected = new Float64Array(STEPS);
    for (let step = 0; step < STEPS; step++) {
      expected[step] = js.step(step === 0 ? 1 : 0, 0, 0);
    }
    const actual = rustSolverOutputs(engine, model, shape, nose);
    expect(actual.every(Number.isFinite)).toBe(true);
    const error = relativeRms(actual, expected);
    globalThis.console.log(`solver: relative RMS difference ${error}`);
    expect(error).toBeLessThan(1e-9);
  });

  it('render matches', async () => {
    const engine = await loadRustEngine();
    for (const options of [{}, { teeth: false }]) {
      const { difference, peak } = renderDifference(engine, options);
      globalThis.console.log(
        `render ${JSON.stringify(options)}: largest difference ${difference}, peak ${peak}`
      );
      expect(peak).toBeGreaterThan(0.01);
      expect(difference).toBeLessThan(1e-4);
    }
  });

  // The whole render takes minutes in a 40 cm room (60 000 cells); its
  // first samples run every part of the room solver and the listener.
  it('render matches in an enclosure', async () => {
    const engine = await loadRustEngine();
    const { difference, samples, peak } = renderDifference(
      engine,
      { enclosure: { width: 40, height: 40, depth: 40 } },
      ENCLOSURE_SAMPLES
    );
    globalThis.console.log(
      `render in an enclosure, ${samples} samples: largest difference ${difference}, peak ${peak}`
    );
    expect(samples).toBe(ENCLOSURE_SAMPLES);
    expect(difference).toBeLessThan(1e-4);
  });

  it('loader falls back to scalar', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'wasm-loader-'));
    try {
      copyFileSync(
        path.join(root, 'src/engine/wasm-loader.js'),
        path.join(folder, 'wasm-loader.js')
      );
      copyFileSync(
        path.join(root, 'src/engine/voice-simulator.wasm'),
        path.join(folder, 'voice-simulator.wasm')
      );
      expect(existsSync(path.join(folder, 'voice-simulator-simd.wasm'))).toBe(
        false
      );
      const loader = await import(
        pathToFileURL(path.join(folder, 'wasm-loader.js')).href
      );
      const engine = await loader.loadEngineModule(undefined, {
        simd: 'auto',
      });
      expect(engine).not.toBe(null);
      expect(engine.simd).toBe(false);
      expect(await loader.loadEngineModule(undefined, { simd: true })).toBe(
        null
      );
      // A SIMD file the runtime cannot compile falls back the same way.
      writeFileSync(
        path.join(folder, 'voice-simulator-simd.wasm'),
        new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 255])
      );
      const fallback = await loader.loadEngineModule();
      expect(fallback.simd).toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
