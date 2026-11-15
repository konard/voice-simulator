/**
 * The voice renderer on the Rust engine, with the 1D waveguide (issue 22)
 * or the 3D FDTD solver (issue 23); see docs/RUST-ENGINE.md.
 *
 * JavaScript keeps what runs once per control block: it samples the plan,
 * shapes the tract (`blockShape` of src/acoustics/voice.js, the same
 * function VoiceRenderer calls) and resolves the listener; for the 3D
 * solver it also builds and packs the voxel model once. Rust runs what
 * runs per solver step and per sample: the glottis, the noise sources, the
 * air flow, the solver, the output filters, the listener and the limiter.
 * The output matches VoiceRenderer with the same `solver` within the
 * parity class B of docs/RUST-ENGINE.md.
 */

import { hashSeed } from '../random.js';
import { normalizeHeadConfig } from '../head-config.js';
import { noseShape } from '../articulation/tract-shape.js';
import {
  blockShape,
  DEFAULT_SOURCE,
  noseSections,
} from '../acoustics/voice.js';
import { piriformBranch } from '../acoustics/waveguide.js';
import {
  WALL_MASS,
  WALL_RESISTANCE,
  WALL_STIFFNESS,
} from '../acoustics/losses.js';
import { createListener } from '../acoustics/microphone.js';
import {
  buildVoxelModel,
  enclosureBounds,
  voxelModelOptions,
} from '../acoustics/voxel-model.js';
import { VOWEL_CORRECTIONS_3D } from '../articulation/vowel-calibration.js';
import {
  FDTD_OUTPUT_CODES,
  RENDERER_CONFIG,
  SOLVER_CODES,
  frameStride,
  writeFrame,
} from './layout.js';
import { fdtdListening, modelHeader, packVoxelModel } from './pack-model.js';
import { listenerValues } from './listener-layout.js';
import { float32View, float64View } from './wasm-loader.js';

/** REST_LENGTH of waveguide.js: the piriform branch is sized for it. */
const REST_LENGTH = 16.5;

/**
 * An Error with `code = 'ENGINE_UNSUPPORTED'`: the options need a part of
 * the JavaScript renderer the Rust engine does not have.
 * @param {string} message
 */
export function unsupported(message) {
  const error = new Error(`Rust renderer: ${message}`);
  error.code = 'ENGINE_UNSUPPORTED';
  return error;
}

/** Throws an `unsupported` error for options the Rust renderer lacks. */
function checkSupported(options) {
  const solver = options.solver ?? 'waveguide';
  if (!Object.hasOwn(SOLVER_CODES, solver)) {
    throw unsupported(`solver '${solver}' (only 'waveguide' and 'fdtd3d')`);
  }
  if (options.device) {
    throw unsupported('a WebGPU device');
  }
  const source = options.source ?? DEFAULT_SOURCE;
  if (source !== 'lf') {
    throw unsupported(`source '${source}' (only 'lf')`);
  }
  const { bandLimit } = options;
  if (bandLimit !== undefined && bandLimit !== null && !(bandLimit > 0)) {
    throw unsupported(`bandLimit ${bandLimit} (must be above 0)`);
  }
}

/** Throws the engine's negative status `code` as an Error. */
function check(code, what) {
  if (code < 0) {
    throw new Error(`Rust renderer: ${what} failed with code ${code}`);
  }
  return code;
}

/** A growable block of the engine's memory. */
class Scratch {
  constructor(engine, size) {
    this.engine = engine;
    this.size = size;
    this.pointer = 0;
    this.bytes = 0;
  }

  /** The block, at least `count` elements; 0 for none. */
  reserve(count) {
    const bytes = count * this.size;
    if (bytes > this.bytes) {
      this.free();
      const size = Math.max(bytes, 2 * this.bytes);
      this.pointer = this.engine.exports.vs_alloc(size);
      if (this.pointer === 0) {
        throw new Error('Rust renderer: out of engine memory');
      }
      this.bytes = size;
    }
    return this.pointer;
  }

  free() {
    if (this.pointer !== 0) {
      this.engine.exports.vs_free(this.pointer, this.bytes);
    }
    this.pointer = 0;
    this.bytes = 0;
  }
}

/**
 * The renderer configuration (RENDERER_CONFIG of layout.js).
 * @returns {Float64Array}
 */
export function rendererConfig(settings) {
  const { head, sections, listener } = settings;
  const nose = noseShape(head).areas;
  const branch = piriformBranch(sections, REST_LENGTH, head);
  const C = RENDERER_CONFIG;
  const values = new Float64Array(C.HEADER + nose.length + listener.length);
  values[C.SAMPLE_RATE] = settings.sampleRate;
  values[C.SECTIONS] = sections;
  values[C.NOSE_SECTIONS] = noseSections(head, sections);
  values[C.BLOCK_SIZE] = settings.blockSize;
  values[C.TOTAL_SAMPLES] = settings.totalSamples;
  values[C.GLOTTIS_SEED] = hashSeed(`${settings.seed}:glottis`);
  values[C.NOISE_SEED] = hashSeed(`${settings.seed}:noise`);
  values[C.TENSENESS] = head.tenseness;
  values[C.BREATHINESS] = head.breathiness;
  values[C.JITTER] = head.jitter;
  values[C.SHIMMER] = head.shimmer;
  values[C.ASPIRATION_LEVEL] = head.aspirationLevel;
  values[C.GLOTTAL_CHINK] = head.glottalChink;
  values[C.LUNG_PRESSURE] = head.lungPressure;
  values[C.VOCAL_TRACT_LENGTH] = head.vocalTractLength;
  values[C.FRICATION_LEVEL] = head.fricationLevel;
  values[C.OUTPUT_GAIN] = head.outputGain;
  values[C.WALL_LOSS] = head.wallLoss;
  values[C.NASAL_LOSS] = head.nasalLoss;
  values[C.PHARYNX_WIDTH] = head.pharynxWidth ?? 1;
  values[C.PIRIFORM] = settings.piriform ? 1 : 0;
  values[C.TEETH] = settings.teeth ? 1 : 0;
  values[C.BAND_LIMIT] = settings.bandLimit ?? 0;
  values[C.PIRIFORM_INDEX] = branch.index;
  values[C.PIRIFORM_AREA] = branch.area;
  values[C.PIRIFORM_SECTIONS] = settings.piriform ? branch.sections : 0;
  values[C.NOSE_AREA_COUNT] = nose.length;
  values[C.LISTENER_LENGTH] = listener.length;
  values[C.WALL_MASS] = head.wallMass ?? WALL_MASS;
  values[C.WALL_RESISTANCE] = head.wallResistance ?? WALL_RESISTANCE;
  values[C.WALL_STIFFNESS] = head.wallStiffness ?? WALL_STIFFNESS;
  const { listening } = settings;
  values[C.SOLVER] = SOLVER_CODES[settings.solver ?? 'waveguide'];
  if (listening) {
    values[C.FDTD_OUTPUT] = FDTD_OUTPUT_CODES[listening.output];
    values[C.FDTD_SPHERICAL] = listening.spherical ? 1 : 0;
    values[C.MICROPHONE_X] = listening.target[0];
    values[C.MICROPHONE_Y] = listening.target[1];
    values[C.MICROPHONE_Z] = listening.target[2];
  }
  values.set(nose, C.HEADER);
  values.set(listener, C.HEADER + nose.length);
  return values;
}

/**
 * A renderer of the engine for `config` and the packed voxel model
 * `model` (bytes; empty for the waveguide); returns its handle.
 */
function createRenderer(module, config, model = new Uint8Array(0)) {
  const scratch = new Scratch(module, 8);
  const modelScratch = new Scratch(module, 1);
  try {
    const pointer = scratch.reserve(config.length);
    const modelPointer = modelScratch.reserve(model.length);
    new Uint8Array(module.memory.buffer, modelPointer, model.length).set(model);
    float64View(module, pointer, config.length).set(config);
    return check(
      module.exports.vs_renderer_new(
        pointer,
        config.length,
        modelPointer,
        model.length
      ),
      'vs_renderer_new'
    );
  } finally {
    scratch.free();
    modelScratch.free();
  }
}

/**
 * The voxel model the 3D solver of VoiceRenderer builds for `options`
 * (the constructor of Fdtd3d with the options VoiceRenderer gives it).
 */
export function rendererModel(head, options = {}) {
  if (options.model) {
    return options.model;
  }
  const modelOptions = {
    head,
    dx: options.dx,
    microphone: options.microphone,
    enclosure: options.enclosure,
    piriform: options.piriform,
    vallecula: options.vallecula,
  };
  return buildVoxelModel(head, {
    ...modelOptions,
    ...voxelModelOptions(modelOptions),
  });
}

/**
 * The JavaScript half of the Rust renderer: the configuration and the
 * frames, one per control block, computed as VoiceRenderer computes its
 * shapes. Needs no engine, so a job can be written for the CLI.
 */
export class FramePlanner {
  /**
   * @param {object} plan Result of planUtterance.
   * @param {object} [options] as for RustVoiceRenderer
   */
  constructor(plan, options = {}) {
    checkSupported(options);
    this.plan = plan;
    this.head = normalizeHeadConfig(options.head ?? plan.head);
    this.sampleRate = options.sampleRate ?? 48000;
    this.sections = options.sections ?? 44;
    this.blockSize = options.blockSize ?? 32;
    this.teeth = options.teeth !== false;
    this.stride = frameStride(this.sections);
    this.solver = options.solver ?? 'waveguide';
    /** The packed voxel model of the 3D solver; empty for the waveguide. */
    this.model = new Uint8Array(0);
    let listening = null;
    if (this.solver === 'fdtd3d') {
      const model = rendererModel(this.head, options);
      listening = fdtdListening(model, options);
      this.model = new Uint8Array(packVoxelModel(model));
    }
    const listener = createListener({
      microphone: options.microphone,
      room: options.room,
      enclosure: enclosureBounds(this.head, options.enclosure),
      solver: listening ?? {},
      sampleRate: this.sampleRate,
    });
    const values = listenerValues(listener);
    if (!values) {
      throw unsupported('this microphone or room');
    }
    this.totalSamples = Math.ceil(
      (plan.duration + (listener?.tail ?? 0)) * this.sampleRate
    );
    this.config = rendererConfig({
      head: this.head,
      sections: this.sections,
      sampleRate: this.sampleRate,
      blockSize: this.blockSize,
      totalSamples: this.totalSamples,
      seed: options.seed ?? 1,
      piriform: options.piriform !== false,
      teeth: this.teeth,
      bandLimit: options.bandLimit,
      listener: values,
      solver: this.solver,
      listening,
    });
    this.frames = new FrameList(this.stride);
    this.state = {};
    this.shapeOptions = { sections: this.sections, teeth: this.teeth };
    if (this.solver === 'fdtd3d') {
      this.shapeOptions.vowelCorrections = VOWEL_CORRECTIONS_3D;
    }
    /** Time of the next sample, summed as VoiceRenderer sums it. */
    this.time = 0;
    this.position = 0;
    this.hasShape = false;
  }

  /**
   * Write the frames of the blocks that start in the next `count` samples
   * into `this.frames.values` and advance the clock.
   * @returns {number} the number of frames
   */
  prepare(count) {
    const outputStep = 1 / this.sampleRate;
    const { blockSize, stride, frames } = this;
    let blocks = 0;
    for (let index = 0; index < count; index++) {
      if ((this.position + index) % blockSize === 0 || !this.hasShape) {
        this.hasShape = true;
        const shape = blockShape(
          this.plan,
          this.time,
          this.state,
          this.head,
          this.shapeOptions
        );
        const lung = this.state.lungPressure ?? this.head.lungPressure;
        frames.ensure(blocks + 1);
        writeFrame(frames.values, blocks * stride, shape, lung);
        blocks++;
      }
      this.time += outputStep;
    }
    this.position += count;
    return blocks;
  }
}

/**
 * VoiceRenderer with the waveguide or the 3D FDTD solver, on the Rust
 * engine. Free its engine memory with free() when done.
 */
export class RustVoiceRenderer {
  /**
   * @param {{exports: Record<string, Function>, memory: WebAssembly.Memory}} module
   *   the engine of loadEngineModule (src/engine/wasm-loader.js)
   * @param {object} plan Result of planUtterance.
   * @param {ConstructorParameters<typeof import('../acoustics/voice.js').VoiceRenderer>[1]} [options]
   *   as for VoiceRenderer; a `solver` other than 'waveguide' and
   *   'fdtd3d', `device`, `source: 'folds'` and a `bandLimit` that is not
   *   above 0 throw an Error with `code = 'ENGINE_UNSUPPORTED'`. With
   *   'fdtd3d' the voxel model is `options.model`, or the one Fdtd3d
   *   builds from `dx`, `microphone`, `enclosure`, `piriform` and
   *   `vallecula`.
   */
  constructor(module, plan, options = {}) {
    this.planner = new FramePlanner(plan, options);
    this.engine = module;
    this.plan = plan;
    const { sampleRate, sections, totalSamples, head, config, model } =
      this.planner;
    this.head = head;
    this.sampleRate = sampleRate;
    this.sections = sections;
    this.solver = this.planner.solver;
    this.totalSamples = totalSamples;
    /** Cells of the voxel model (the 3D solver), for field(). */
    this.cells = model.length > 0 ? modelCells(model) : 0;
    this.handle = createRenderer(module, config, model);
    this.frames = new Scratch(module, 8);
    this.out = new Scratch(module, 4);
    this.fieldValues = new Scratch(module, 8);
    this.position = 0;
    /** Milliseconds spent preparing frames in JavaScript. */
    this.prepareTime = 0;
  }

  get duration() {
    return this.plan.duration;
  }

  get done() {
    return this.position >= this.totalSamples;
  }

  /**
   * Render the next samples into `target`. Any chunking gives identical
   * audio.
   * @param {Float32Array} target
   * @returns {number} Number of samples written (less than target.length at the end).
   */
  render(target) {
    const count = Math.max(
      0,
      Math.min(target.length, this.totalSamples - this.position)
    );
    if (count === 0) {
      return 0;
    }
    if (this.handle === undefined) {
      throw new Error('Rust renderer: used after free()');
    }
    const { engine, planner } = this;
    const started = globalThis.performance.now();
    const blocks = planner.prepare(count);
    this.prepareTime += globalThis.performance.now() - started;
    const frameValues = blocks * planner.stride;
    const framePointer = this.frames.reserve(Math.max(1, frameValues));
    const outPointer = this.out.reserve(count);
    float64View(engine, framePointer, frameValues).set(
      planner.frames.values.subarray(0, frameValues)
    );
    const written = check(
      engine.exports.vs_renderer_render(
        this.handle,
        framePointer,
        blocks,
        outPointer,
        count
      ),
      'vs_renderer_render'
    );
    target.set(float32View(engine, outPointer, written));
    this.position += written;
    return written;
  }

  /**
   * render() as a promise, for callers written for the GPU renderer.
   * @param {Float32Array} target
   * @returns {Promise<number>}
   */
  renderAsync(target) {
    return Promise.resolve().then(() => this.render(target));
  }

  /**
   * Acoustic pressure per section, as Waveguide.field() gives it; with the
   * 3D solver, `{pressure}` holds the pressure of every cell of the model,
   * as the `pressure` array of Fdtd3d.
   * @returns {{pressure: Float64Array, nose?: Float64Array}}
   */
  field() {
    if (this.solver === 'fdtd3d') {
      const pointer = this.fieldValues.reserve(this.cells);
      const written = check(
        this.engine.exports.vs_renderer_field(this.handle, pointer, this.cells),
        'vs_renderer_field'
      );
      return { pressure: float64View(this.engine, pointer, written).slice() };
    }
    const noseCount = noseSections(this.head, this.sections);
    const total = this.sections + noseCount;
    const pointer = this.fieldValues.reserve(total);
    const written = check(
      this.engine.exports.vs_renderer_field(this.handle, pointer, total),
      'vs_renderer_field'
    );
    const values = float64View(this.engine, pointer, written).slice();
    return {
      pressure: values.subarray(0, this.sections),
      nose: values.subarray(this.sections),
    };
  }

  /** Free the engine memory of this renderer. */
  free() {
    if (this.handle !== undefined) {
      this.engine.exports.vs_renderer_free(this.handle);
      this.handle = undefined;
    }
    this.frames.free();
    this.out.free();
    this.fieldValues.free();
  }
}

/** Cells of a packed voxel model (MODEL_HEADER.CELLS). */
function modelCells(model) {
  return modelHeader(model.buffer).CELLS;
}

/** A growable Float64Array of frames. */
class FrameList {
  constructor(stride) {
    this.stride = stride;
    this.values = new Float64Array(stride * 4);
  }

  ensure(frames) {
    if (frames * this.stride > this.values.length) {
      const grown = new Float64Array(
        Math.max(frames * this.stride, 2 * this.values.length)
      );
      grown.set(this.values);
      this.values = grown;
    }
  }
}

/**
 * Render a whole plan with the Rust renderer.
 * @param {ConstructorParameters<typeof RustVoiceRenderer>[0]} module the engine
 * @param {object} plan
 * @param {object} [options] as for RustVoiceRenderer
 * @returns {Float32Array}
 */
export function renderPlanRust(module, plan, options = {}) {
  const renderer = new RustVoiceRenderer(module, plan, options);
  try {
    const samples = new Float32Array(renderer.totalSamples);
    renderer.render(samples);
    return samples;
  } finally {
    renderer.free();
  }
}

/**
 * A render job for `voice-simulator-cli render-job`: little-endian `f64`
 * values `[config length, config..., model length, model..., frame count,
 * frames..., sample count]` with the frames of the whole utterance. The
 * model is the packed voxel model of the 3D solver (its length in bytes,
 * a multiple of 8; 0 for the waveguide).
 * @param {object} plan
 * @param {object} [options] as for RustVoiceRenderer
 * @returns {{config: Float64Array, model: Uint8Array, frames: Float64Array, frameCount: number, samples: number, bytes: Uint8Array}}
 */
export function renderJob(plan, options = {}) {
  const planner = new FramePlanner(plan, options);
  const samples = planner.totalSamples;
  const frameCount = planner.prepare(samples);
  const frames = planner.frames.values.slice(0, frameCount * planner.stride);
  const { config, model } = planner;
  const head = 2 + config.length;
  const bytes = new Uint8Array(8 * (head + 2 + frames.length) + model.length);
  const view = new DataView(bytes.buffer);
  const put = (index, value) => view.setFloat64(8 * index, value, true);
  put(0, config.length);
  config.forEach((value, index) => put(1 + index, value));
  put(1 + config.length, model.length);
  bytes.set(model, 8 * head);
  const after = head + model.length / 8;
  put(after, frameCount);
  frames.forEach((value, index) => put(after + 1 + index, value));
  put(after + 1 + frames.length, samples);
  return { config, model, frames, frameCount, samples, bytes };
}

/**
 * Render a job of renderJob in one call of the engine, as the CLI does.
 * @param {ConstructorParameters<typeof RustVoiceRenderer>[0]} module
 * @param {ReturnType<typeof renderJob>} job
 * @returns {Float32Array}
 */
export function renderJobRust(module, job) {
  const handle = createRenderer(module, job.config, job.model);
  const frames = new Scratch(module, 8);
  const out = new Scratch(module, 4);
  try {
    const framePointer = frames.reserve(Math.max(1, job.frames.length));
    const outPointer = out.reserve(Math.max(1, job.samples));
    float64View(module, framePointer, job.frames.length).set(job.frames);
    const written = check(
      module.exports.vs_renderer_render(
        handle,
        framePointer,
        job.frameCount,
        outPointer,
        job.samples
      ),
      'vs_renderer_render'
    );
    return float32View(module, outPointer, written).slice();
  } finally {
    module.exports.vs_renderer_free(handle);
    frames.free();
    out.free();
  }
}
