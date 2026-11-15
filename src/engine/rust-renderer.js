/**
 * The waveguide voice renderer on the Rust engine (issue 22,
 * docs/RUST-ENGINE.md).
 *
 * JavaScript keeps what runs once per control block: it samples the plan,
 * shapes the tract (`blockShape` of src/acoustics/voice.js, the same
 * function VoiceRenderer calls) and resolves the listener. Rust runs what
 * runs per solver step and per sample: the glottis, the noise sources, the
 * air flow, the waveguide, the output filters, the listener and the
 * limiter. The output matches VoiceRenderer with `solver: 'waveguide'`
 * within the parity class B of docs/RUST-ENGINE.md.
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
import { createListener } from '../acoustics/microphone.js';
import { enclosureBounds } from '../acoustics/voxel-model.js';
import { RENDERER_CONFIG, frameStride, writeFrame } from './layout.js';
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
  if (solver !== 'waveguide') {
    throw unsupported(`solver '${solver}' (only 'waveguide')`);
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
  values.set(nose, C.HEADER);
  values.set(listener, C.HEADER + nose.length);
  return values;
}

/**
 * VoiceRenderer with the waveguide, on the Rust engine. Free its engine
 * memory with free() when done.
 */
export class RustVoiceRenderer {
  /**
   * @param {{exports: Record<string, Function>, memory: WebAssembly.Memory}} module
   *   the engine of loadEngineModule (src/engine/wasm-loader.js)
   * @param {object} plan Result of planUtterance.
   * @param {ConstructorParameters<typeof import('../acoustics/voice.js').VoiceRenderer>[1]} [options]
   *   as for VoiceRenderer; `solver` other than 'waveguide', `device`,
   *   `source: 'folds'` and a `bandLimit` that is not above 0 throw an
   *   Error with `code = 'ENGINE_UNSUPPORTED'`.
   */
  constructor(module, plan, options = {}) {
    checkSupported(options);
    this.engine = module;
    this.plan = plan;
    this.head = normalizeHeadConfig(options.head ?? plan.head);
    this.sampleRate = options.sampleRate ?? 48000;
    this.sections = options.sections ?? 44;
    this.blockSize = options.blockSize ?? 32;
    this.teeth = options.teeth !== false;
    this.stride = frameStride(this.sections);
    const listener = createListener({
      microphone: options.microphone,
      room: options.room,
      enclosure: enclosureBounds(this.head, options.enclosure),
      solver: {},
      sampleRate: this.sampleRate,
    });
    const values = listenerValues(listener);
    if (!values) {
      throw unsupported('this microphone or room');
    }
    this.totalSamples = Math.ceil(
      (plan.duration + (listener?.tail ?? 0)) * this.sampleRate
    );
    const config = rendererConfig({
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
    });
    const scratch = new Scratch(module, 8);
    try {
      const pointer = scratch.reserve(config.length);
      float64View(module, pointer, config.length).set(config);
      this.handle = check(
        module.exports.vs_renderer_new(pointer, config.length),
        'vs_renderer_new'
      );
    } finally {
      scratch.free();
    }
    this.frames = new Scratch(module, 8);
    this.out = new Scratch(module, 4);
    this.fieldValues = new Scratch(module, 8);
    this.frameList = new FrameList(this.stride);
    this.state = {};
    this.shapeOptions = { sections: this.sections, teeth: this.teeth };
    /** Time of the next sample, summed as VoiceRenderer sums it. */
    this.time = 0;
    this.position = 0;
    this.hasShape = false;
  }

  get duration() {
    return this.plan.duration;
  }

  get done() {
    return this.position >= this.totalSamples;
  }

  /**
   * Write the frames of the blocks that start in the next `count` samples
   * into `target` and advance the clock; returns the number of frames.
   */
  #prepare(count, frames) {
    const outputStep = 1 / this.sampleRate;
    const { blockSize, stride } = this;
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
    return blocks;
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
    const frames = this.frameList;
    const blocks = this.#prepare(count, frames);
    const { engine } = this;
    const frameValues = blocks * this.stride;
    const framePointer = this.frames.reserve(Math.max(1, frameValues));
    const outPointer = this.out.reserve(count);
    float64View(engine, framePointer, frameValues).set(
      frames.values.subarray(0, frameValues)
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
   * Acoustic pressure per section, as Waveguide.field() gives it.
   * @returns {{pressure: Float64Array, nose: Float64Array}}
   */
  field() {
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
