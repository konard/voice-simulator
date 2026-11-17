/**
 * The voice renderer on the Rust engine, with the waveguide, 2D or 3D
 * solver, LF or physical folds and whisper; see docs/RUST-ENGINE.md.
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

import { buildSheet, sheetColumn } from '../acoustics/sheet-model.js';
import { sideBranches } from '../acoustics/sinuses.js';
import { hashSeed } from '../random.js';
import { normalizeHeadConfig } from '../head-config.js';
import { noseShape } from '../articulation/tract-shape.js';
import {
  blockShape,
  DEFAULT_SOURCE,
  levelFactor,
  noseSections,
} from '../acoustics/voice.js';
import { piriformBranch } from '../acoustics/waveguide.js';
import {
  WALL_MASS,
  WALL_RESISTANCE,
  WALL_STIFFNESS,
} from '../acoustics/losses.js';
import { createListener, headListening } from '../acoustics/microphone.js';
import {
  buildVoxelModel,
  enclosureBounds,
  voxelModelOptions,
} from '../acoustics/voxel-model.js';
import {
  VOWEL_CORRECTIONS_2D,
  VOWEL_CORRECTIONS_3D,
} from '../articulation/vowel-calibration.js';
import { VOWEL_LENGTH_SCALE_3D } from '../articulation/vowel-space.js';
import {
  FDTD_OUTPUT_CODES,
  RENDERER_CONFIG,
  SOLVER_CODES,
  SOURCE_STATE,
  frameStride,
  writeFrame,
} from './layout.js';
import { fdtdListening, modelHeader, packVoxelModel } from './pack-model.js';
import { listenerValues } from './listener-layout.js';
import { float32View, float64View } from './wasm-loader.js';

/** REST_LENGTH of waveguide.js: the piriform branch is sized for it. */
const REST_LENGTH = 16.5;

/**
 * An Error with `code = 'ENGINE_UNSUPPORTED'`: invalid CPU options, or a
 * custom solver/WebGPU device that requires an explicit JavaScript engine.
 * @param {string} message
 */
export function unsupported(message) {
  const error = new Error(`Rust renderer: ${message}`);
  error.code = 'ENGINE_UNSUPPORTED';
  return error;
}

/**
 * Validate the CPU solver, source, WebGPU device and band limit options.
 * The microphone and the room are checked when a renderer is built.
 * @param {object} options as for RustVoiceRenderer
 */
export function checkSupported(options) {
  const solver = options.solver ?? 'waveguide';
  if (!Object.hasOwn(SOLVER_CODES, solver)) {
    throw unsupported(`solver '${solver}' (use waveguide, fdtd2d or fdtd3d)`);
  }
  if (options.device) {
    throw unsupported('a WebGPU device');
  }
  const source = options.source ?? DEFAULT_SOURCE;
  if (!['lf', 'folds'].includes(source)) {
    throw unsupported(`unknown source '${source}'`);
  }
  if (options.interaction && source !== 'folds') {
    throw new Error('Source-tract interaction requires source: folds');
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

/** Slots of RENDERER_CONFIG and the head keys they hold (issue 41). */
const ADVANCED_CONFIG = [
  ['BREATH_GAIN', 'breathGain'],
  ['BREATH_EXPONENT', 'breathExponent'],
  ['BREATHINESS_RD', 'breathinessRd'],
  ['CHINK_NOISE', 'chinkNoise'],
  ['ORAL_COMPLIANCE', 'oralCompliance'],
  ['RE_CRITICAL', 'reCritical'],
  ['GLOTTIS_VOICED', 'glottisVoiced'],
  ['GLOTTIS_OPEN', 'glottisOpen'],
  ['GLOTTIS_BREATHY', 'glottisBreathy'],
  ['WALL_SOURCE', 'wallSource'],
  ['STROUHAL', 'strouhal'],
  ['FRICATION_GAIN', 'fricationGain'],
  ['TRANSIENT_GAIN', 'transientGain'],
  ['LOSS_SHAPE', 'lossShape'],
  ['RADIATION_BAFFLE', 'radiationBaffle'],
  ['FOLD_LENGTH', 'foldLength'],
  ['FOLD_MASS', 'foldMass'],
  ['FOLD_STIFFNESS', 'foldStiffness'],
  ['FOLD_DAMPING', 'foldDamping'],
  ['PRESSURE_COEFFICIENT', 'glottalPressureCoefficient'],
  ['SUBGLOTTAL_LENGTH', 'subglottalLength'],
  ['SUBGLOTTAL_LOSS', 'subglottalLoss'],
  ['PITCH', 'pitch'],
];

function configureWalls(values, head) {
  const C = RENDERER_CONFIG;
  values[C.WALL_MASS] = head.wallMass ?? WALL_MASS;
  values[C.WALL_RESISTANCE] = head.wallResistance ?? WALL_RESISTANCE;
  values[C.WALL_STIFFNESS] = head.wallStiffness ?? WALL_STIFFNESS;
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
  values[C.OUTPUT_GAIN] = head.outputGain * levelFactor(settings.levelOffsetDb);
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
  configureWalls(values, head);
  // The advanced source and loss values (issue 41); the head is normalized,
  // so each holds its default when the head leaves it out.
  for (const [slot, key] of ADVANCED_CONFIG) {
    values[C[slot]] = head[key];
  }
  const { listening } = settings;
  values[C.SOLVER] = SOLVER_CODES[settings.solver ?? 'waveguide'];
  if (listening) {
    values[C.FDTD_OUTPUT] = FDTD_OUTPUT_CODES[listening.output];
    values[C.FDTD_SPHERICAL] = listening.spherical ? 1 : 0;
    values[C.MICROPHONE_X] = listening.target[0];
    values[C.MICROPHONE_Y] = listening.target[1];
    values[C.MICROPHONE_Z] = listening.target[2];
  }
  values[C.SOURCE] = settings.source === 'folds' ? 1 : 0;
  values[C.INTERACTION] = settings.interaction ? 1 : 0;
  values[C.SUBGLOTTAL] = settings.subglottal !== false ? 1 : 0;
  values[C.LENGTH_SCALE] = settings.lengthScale ?? 1;
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
 * The lengthScale VoiceRenderer gives Fdtd3d (lengthScaleOf of voice.js):
 * the one of the 3D vowel table unless the options give one.
 * @param {string} solver
 * @param {object} options
 * @returns {number|undefined}
 */
function lengthScaleOf(solver, options) {
  return (
    options.lengthScale ??
    (solver === 'fdtd3d' ? VOWEL_LENGTH_SCALE_3D : undefined)
  );
}

/** Calibration shared with the corresponding reference solver. */
function vowelCorrections(solver) {
  if (solver === 'fdtd2d') {
    return VOWEL_CORRECTIONS_2D;
  }
  if (solver === 'fdtd3d') {
    return VOWEL_CORRECTIONS_3D;
  }
  return undefined;
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
    // The head's microphone and room unless the options give their own.
    options = headListening(this.head, options);
    this.sampleRate = options.sampleRate ?? 48000;
    this.sections = options.sections ?? 44;
    this.blockSize = options.blockSize ?? 32;
    this.teeth = options.teeth !== false;
    this.stride = frameStride(this.sections);
    this.solver = options.solver ?? 'waveguide';
    /** Packed geometry of the 2D/3D solver; empty for the waveguide. */
    this.model = new Uint8Array(0);
    let listening = null;
    if (this.solver === 'fdtd3d') {
      const model = rendererModel(this.head, options);
      listening = fdtdListening(model, options);
      this.model = new Uint8Array(packVoxelModel(model));
    }
    if (this.solver === 'fdtd2d') {
      this.model = packSheet(this.head, options);
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
    /** The listener, for its `tail` (s). */
    this.listener = listener;
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
      lengthScale: lengthScaleOf(this.solver, options),
      levelOffsetDb: options.levelOffsetDb,
      source: options.source,
      interaction: options.interaction,
      subglottal: options.subglottal,
    });
    this.frames = new FrameList(this.stride);
    this.state = {};
    this.shapeOptions = { sections: this.sections, teeth: this.teeth };
    this.shapeOptions.vowelCorrections = vowelCorrections(this.solver);
    /** Time of the next sample, summed as VoiceRenderer sums it. */
    this.time = 0;
    this.position = 0;
    this.hasShape = false;
    this.seek(options.startTime ?? 0);
  }

  /**
   * Start at `seconds` into the utterance, as VoiceRenderer does with
   * `startTime` (issue 29): the nearest sample, a frame for the block it
   * starts in.
   * @param {number} seconds
   */
  seek(seconds) {
    this.position = Math.round(seconds * this.sampleRate);
    this.time = this.position / this.sampleRate;
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
 * VoiceRenderer with the waveguide, 2D or 3D solver, on the Rust
 * engine. Free its engine memory with free() when done.
 */
export class RustVoiceRenderer {
  /**
   * @param {{exports: Record<string, Function>, memory: WebAssembly.Memory}} module
   *   the engine of loadEngineModule (src/engine/wasm-loader.js)
   * @param {object} plan Result of planUtterance.
   * @param {ConstructorParameters<typeof import('../acoustics/voice.js').VoiceRenderer>[1]} [options]
   *   as for VoiceRenderer; custom solvers, a WebGPU `device` and a `bandLimit` that is not
   *   above 0 throw an Error with `code = 'ENGINE_UNSUPPORTED'`. With
   *   'fdtd3d' the voxel model is `options.model`, or the one Fdtd3d
   *   builds from `dx`, `microphone`, `enclosure`, `piriform` and
   *   `vallecula`. `threadMinLinks` overrides THREAD_MIN_LINKS of the
   *   engine for this renderer (0: a thread team for any grid; tests and
   *   measurements).
   */
  constructor(module, plan, options = {}) {
    this.planner = new FramePlanner(plan, options);
    this.module = module;
    this.plan = plan;
    const { sampleRate, sections, totalSamples, head, config, model } =
      this.planner;
    this.head = head;
    this.sampleRate = sampleRate;
    this.sections = sections;
    this.solver = this.planner.solver;
    this.source = options.source ?? DEFAULT_SOURCE;
    this.totalSamples = totalSamples;
    /** Cells of the voxel model (the 3D solver), for field(). */
    this.cells = this.solver === 'fdtd3d' ? modelCells(model) : 0;
    if (this.solver === 'fdtd2d') {
      const header = new Float64Array(model.buffer, model.byteOffset, 5);
      this.sheetRows = header[1];
      this.sheetColumns = header[2];
      this.sheetNose = header[3];
    }
    this.listener = this.planner.listener;
    this.handle = createRenderer(module, config, model);
    this.frames = new Scratch(module, 8);
    this.out = new Scratch(module, 4);
    this.fieldValues = new Scratch(module, 8);
    this.position = this.planner.position;
    if (this.position !== 0) {
      check(
        module.exports.vs_renderer_seek(this.handle, options.startTime),
        'vs_renderer_seek'
      );
    }
    /** Milliseconds spent preparing frames in JavaScript. */
    this.prepareTime = 0;
    this.threadMinLinks = options.threadMinLinks;
    /**
     * Threads that stepped the solver in the last render() call: above 1
     * only with an engine of `threads` above 1 and a grid of at least
     * THREAD_MIN_LINKS links.
     */
    this.threads = 1;
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
    const { module: engine, planner } = this;
    const started = globalThis.performance.now();
    const blocks = planner.prepare(count);
    this.prepareTime += globalThis.performance.now() - started;
    const frameValues = blocks * planner.stride;
    const framePointer = this.frames.reserve(Math.max(1, frameValues));
    const outPointer = this.out.reserve(count);
    float64View(engine, framePointer, frameValues).set(
      planner.frames.values.subarray(0, frameValues)
    );
    const { result: written, threads } = withTeam(
      engine,
      this.handle,
      () =>
        check(
          engine.exports.vs_renderer_render(
            this.handle,
            framePointer,
            blocks,
            outPointer,
            count
          ),
          'vs_renderer_render'
        ),
      this.threadMinLinks
    );
    this.threads = threads;
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
   * Acoustic pressure per section, as Waveguide.field() gives it; the 2D
   * solver also returns `cells`, the pressure at each sheet cell. With the
   * 3D solver, `{pressure}` holds the pressure of every cell of the model,
   * as the `pressure` array of Fdtd3d.
   * @returns {{pressure: Float64Array, nose?: Float64Array, cells?: Float64Array}}
   */
  field() {
    if (this.solver === 'fdtd3d') {
      const pointer = this.fieldValues.reserve(this.cells);
      const written = check(
        this.module.exports.vs_renderer_field(this.handle, pointer, this.cells),
        'vs_renderer_field'
      );
      return { pressure: float64View(this.module, pointer, written).slice() };
    }
    const sections = this.sheetColumns ?? this.sections;
    const noseCount = this.sheetNose ?? noseSections(this.head, sections);
    const cells = this.sheetRows ? this.sheetRows * sections : 0;
    const total = sections + noseCount + cells;
    const pointer = this.fieldValues.reserve(total);
    const written = check(
      this.module.exports.vs_renderer_field(this.handle, pointer, total),
      'vs_renderer_field'
    );
    const values = float64View(this.module, pointer, written).slice();
    return {
      pressure: values.subarray(0, sections),
      nose: values.subarray(sections, sections + noseCount),
      ...(cells ? { cells: values.subarray(sections + noseCount) } : {}),
    };
  }

  /**
   * The glottis state, as `saveSources()` of VoiceRenderer gives it
   * (SOURCE_STATE of layout.js, issue 29).
   * @returns {Float64Array}
   */
  saveSources() {
    // The reference's two-mass source has no transferable state (issue 29).
    if (this.source === 'folds') {
      return new Float64Array(0);
    }
    const pointer = this.fieldValues.reserve(SOURCE_STATE.LENGTH);
    const written = check(
      this.module.exports.vs_renderer_sources_save(this.handle, pointer),
      'vs_renderer_sources_save'
    );
    return float64View(this.module, pointer, written).slice();
  }

  /**
   * Take over the source state of another renderer of the same utterance
   * (`saveSources()` of this class or of VoiceRenderer with the 'lf'
   * source). An empty array changes nothing.
   * @param {ArrayLike<number>} state
   */
  restoreSources(state) {
    if (state.length === 0 || this.source === 'folds') {
      return;
    }
    if (state.length !== SOURCE_STATE.LENGTH) {
      throw new Error(
        `Rust renderer: a source state has ${SOURCE_STATE.LENGTH} values, not ${state.length}`
      );
    }
    const pointer = this.fieldValues.reserve(SOURCE_STATE.LENGTH);
    float64View(this.module, pointer, SOURCE_STATE.LENGTH).set(state);
    check(
      this.module.exports.vs_renderer_sources_restore(this.handle, pointer),
      'vs_renderer_sources_restore'
    );
  }

  /** Free the engine memory of this renderer. */
  free() {
    if (this.handle !== undefined) {
      this.module.exports.vs_renderer_free(this.handle);
      this.handle = undefined;
    }
    this.frames.free();
    this.out.free();
    this.fieldValues.free();
  }
}

/**
 * Run `action` (a render call of the renderer `handle`) with the 3D solver
 * stepped by a thread team of the engine's pool, when the engine has one
 * (`loadEngineModule` with `threads` above 1) and the grid has at least
 * `minLinks` links (by default THREAD_MIN_LINKS of the engine): start the
 * team, wake the helpers, run `action`, end the team. The samples are the
 * same bits with any number of threads.
 * @returns {{result: unknown, threads: number}} what `action` returned and
 *   the threads that stepped the solver
 */
export function withTeam(module, handle, action, minLinks) {
  const { pool } = module;
  if (!pool || pool.size <= 1) {
    return { result: action(), threads: 1 };
  }
  const { exports } = module;
  const team = check(
    minLinks === undefined
      ? exports.vs_team_new(handle, pool.size)
      : exports.vs_team_new_from(handle, pool.size, minLinks),
    'vs_team_new'
  );
  if (team === 0) {
    return { result: action(), threads: 1 };
  }
  pool.run(team);
  try {
    const threads = check(
      exports.vs_renderer_threads(handle),
      'vs_renderer_threads'
    );
    return { result: action(), threads };
  } finally {
    check(exports.vs_team_free(team), 'vs_team_free');
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
 * @param {{threadMinLinks?: number}} [options] `threadMinLinks` as for
 *   RustVoiceRenderer
 * @returns {Float32Array} the samples; its `threads` property holds the
 *   threads that stepped the solver
 */
export function renderJobRust(module, job, options = {}) {
  const handle = createRenderer(module, job.config, job.model);
  const frames = new Scratch(module, 8);
  const out = new Scratch(module, 4);
  try {
    const framePointer = frames.reserve(Math.max(1, job.frames.length));
    const outPointer = out.reserve(Math.max(1, job.samples));
    float64View(module, framePointer, job.frames.length).set(job.frames);
    const { result: written, threads } = withTeam(
      module,
      handle,
      () =>
        check(
          module.exports.vs_renderer_render(
            handle,
            framePointer,
            job.frameCount,
            outPointer,
            job.samples
          ),
          'vs_renderer_render'
        ),
      options.threadMinLinks
    );
    const samples = float32View(module, outPointer, written).slice();
    samples.threads = threads;
    return samples;
  } finally {
    module.exports.vs_renderer_free(handle);
    frames.free();
    out.free();
  }
}

/** Static sheet dimensions, anatomical widths and branch attachments (f64 LE). */
function packSheet(head, options) {
  const sheet = buildSheet(head, { dx: options.dx });
  const nose = noseShape(head);
  const scale = sheet.length / head.vocalTractLength;
  const step = 0.68 * sheet.dx;
  const branches = sideBranches(head, options);
  const values = [
    sheet.dx,
    sheet.rows,
    sheet.columns,
    Math.max(6, Math.round((nose.length * scale) / step)),
    branches.length,
    ...sheet.widths,
  ];
  for (const branch of branches) {
    values.push(
      sheetColumn(sheet, branch.entry / head.vocalTractLength),
      branch.area,
      Math.max(2, Math.round((branch.depth * scale) / step))
    );
  }
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return bytes;
}
