/**
 * Real-time voice renderer: plan (articulator trajectories) -> audio.
 *
 * Every control block the articulator state is sampled, converted into a
 * tract shape for the current head and handed to an acoustic solver. The
 * solver runs at its own step rate (which for the waveguide depends on the
 * tract length) and its output is band-limited and resampled to the audio
 * rate. Rendering is incremental, so the same class serves offline
 * synthesis, AudioWorklets and the streaming server.
 *
 * Optional `microphone`, `room` and `enclosure` settings add a listening
 * chain after the solver (see microphone.js and room.js); without them the
 * output is unchanged.
 */

import {
  sampleState,
  tractShape,
  noseShape,
} from '../articulation/tract-shape.js';
import { normalizeHeadConfig } from '../head-config.js';
import { VOWEL_CORRECTIONS_3D } from '../articulation/vowel-calibration.js';
import { Biquad, createNoise } from './filters.js';
import { Glottis } from './glottis.js';
import { SPEED_OF_SOUND } from './transfer.js';
import { Waveguide } from './waveguide.js';
import { Fdtd3d } from './fdtd3d.js';
import { createListener } from './microphone.js';
import { enclosureBounds } from './voxel-model.js';

const OUTPUT_GAIN = 0.3;

/** Solver factories by name: 1D waveguide and 3D FDTD. */
/**
 * Vowel calibration of each solver (scripts/calibrate-vowels.mjs); the
 * others use the tube-model table.
 */
const VOWEL_TABLES = new Map([['fdtd3d', VOWEL_CORRECTIONS_3D]]);

const SOLVERS = new Map([
  [
    'waveguide',
    (options) => {
      const solver = new Waveguide(options);
      solver.stepDuration = (shape) =>
        shape.length / (options.sections * SPEED_OF_SOUND);
      return solver;
    },
  ],
  ['fdtd3d', (options) => new Fdtd3d(options)],
]);

/**
 * Register an acoustic solver factory.
 * @param {string} name
 * @param {(options: object) => object} factory
 */
export function registerSolver(name, factory) {
  SOLVERS.set(name, factory);
}

function noseSections(head, sections) {
  const nose = noseShape(head);
  return Math.max(
    6,
    Math.round((sections * nose.length) / head.vocalTractLength)
  );
}

class NoiseSources {
  constructor(seed) {
    this.white = createNoise(`${seed}:noise`);
    this.aspiration = new Biquad();
    this.fricative = new Biquad();
    this.sibilant = new Biquad();
    this.rate = 0;
  }

  configure(rate) {
    if (Math.abs(rate - this.rate) / rate < 0.01) {
      return;
    }
    this.rate = rate;
    this.aspiration.bandpass(800, 0.5, rate);
    this.fricative.bandpass(1500, 0.5, rate);
    this.sibilant.highpass(3200, 0.7, rate);
  }
}

class OutputStage {
  constructor(sampleRate, gain = 1) {
    this.gain = OUTPUT_GAIN * gain;
    this.lowpass = [new Biquad(), new Biquad()];
    this.dcInput = 0;
    this.dcOutput = 0;
    this.dcCoefficient = 1 - (2 * Math.PI * 30) / sampleRate;
    this.cutoff = Math.min(sampleRate * 0.45, 20000);
    this.rate = 0;
  }

  configure(rate) {
    if (Math.abs(rate - this.rate) / rate < 0.01) {
      return;
    }
    this.rate = rate;
    this.lowpass[0].lowpass(this.cutoff, 0.54, rate);
    this.lowpass[1].lowpass(this.cutoff, 1.31, rate);
  }

  filter(value) {
    return this.lowpass[1].process(this.lowpass[0].process(value));
  }

  finish(value) {
    const output = value - this.dcInput + this.dcCoefficient * this.dcOutput;
    this.dcInput = value;
    this.dcOutput = output;
    return Math.tanh(output * this.gain);
  }
}

export class VoiceRenderer {
  /**
   * @param {object} plan Result of planUtterance.
   * `microphone` ({distance, azimuth, elevation, compensate}, cm and
   * degrees relative to the lips), `room` (a ROOM_PRESETS name or
   * {width, height, depth, rt60 | absorption, headPosition} in m and s)
   * and `enclosure` ({width, height, depth, absorption, center} in cm, a
   * box around the head) choose where and in what space the voice is
   * heard. The output grows by the reverberation tail.
   * @param {{sampleRate?: number, sections?: number, solver?: string, seed?: string|number, blockSize?: number, head?: object, dx?: number, model?: object, output?: string, kernel?: string, device?: object, microphone?: object, room?: string|object, enclosure?: object, teeth?: boolean, piriform?: boolean, vallecula?: boolean}} [options]
   *   `teeth: false` leaves out the incisors, `piriform: false` the
   *   piriform fossae (both solvers) and `vallecula: false` the vallecula
   *   (3D only). A WebGPU `device` runs the 3D solver on the GPU; such a
   *   renderer renders with renderAsync.
   */
  constructor(plan, options = {}) {
    this.plan = plan;
    this.head = normalizeHeadConfig(options.head ?? plan.head);
    this.sampleRate = options.sampleRate ?? 48000;
    this.sections = options.sections ?? 44;
    this.blockSize = options.blockSize ?? 32;
    this.teeth = options.teeth !== false;
    const seed = options.seed ?? 1;
    const factory = SOLVERS.get(options.solver ?? 'waveguide');
    if (!factory) {
      throw new Error(`Unknown solver: ${options.solver}`);
    }
    this.solver = factory({
      sections: this.sections,
      noseSections: noseSections(this.head, this.sections),
      head: this.head,
      seed,
      dx: options.dx,
      model: options.model,
      output: options.output,
      kernel: options.kernel,
      device: options.device,
      piriform: options.piriform,
      vallecula: options.vallecula,
      microphone: options.microphone,
      enclosure: options.enclosure,
    });
    this.solver.setNose?.(noseShape(this.head).areas);
    this.vowelCorrections = VOWEL_TABLES.get(options.solver ?? 'waveguide');
    this.glottis = new Glottis({
      seed,
      tenseness: this.head.tenseness,
      breathiness: this.head.breathiness,
      jitter: this.head.jitter,
      shimmer: this.head.shimmer,
      aspirationLevel: this.head.aspirationLevel,
      chink: this.head.glottalChink,
    });
    this.noise = new NoiseSources(seed);
    this.output = new OutputStage(this.sampleRate, this.head.outputGain);
    this.state = {};
    this.time = 0;
    this.position = 0;
    this.listener = createListener({
      microphone: options.microphone,
      room: options.room,
      enclosure: enclosureBounds(this.head, options.enclosure),
      solver: this.solver,
      sampleRate: this.sampleRate,
    });
    this.totalSamples = Math.ceil(
      (plan.duration + (this.listener?.tail ?? 0)) * this.sampleRate
    );
    this.solverTime = 0;
    this.previous = 0;
    this.current = 0;
    this.shape = null;
    this.rates = [];
    this.steps = 0;
  }

  get duration() {
    return this.plan.duration;
  }

  get done() {
    return this.position >= this.totalSamples;
  }

  #updateShape() {
    sampleState(this.plan, this.time, this.state);
    this.shape = tractShape(this.state, this.head, {
      sections: this.sections,
      teeth: this.teeth,
      vowelCorrections: this.vowelCorrections,
    });
    this.solver.setShape(
      this.shape.areas,
      this.shape.velumArea,
      this.shape.velumIndex,
      this.shape.teeth
    );
    this.solver.setLength?.(this.shape.length);
    this.stepDuration = this.solver.stepDuration(this.shape);
    const rate = 1 / this.stepDuration;
    this.noise.configure(rate);
    // The output filter runs when the solver outputs arrive (see #finish).
    this.rates.push(this.steps, rate);
  }

  #fricationNoise(white) {
    const { frication } = this.shape;
    if (frication.gain <= 1e-4) {
      return 0;
    }
    const { noise } = this;
    const broad = noise.fricative.process(white);
    const hiss = noise.sibilant.process(white);
    // A jet hitting the incisors adds a strong high-frequency dipole
    // source; without that obstacle only the broad wall source remains,
    // so sibilants come out as the most intense fricatives (Jongman,
    // Wayland and Wong 2000), here about 8–10 dB below the vowel.
    const colour =
      broad * 0.5 * (1 - frication.obstacle) + hiss * 0.17 * frication.obstacle;
    const voicing = Math.min(1, this.shape.glottis.voicing);
    const flow =
      (1 - this.shape.glottis.closure) *
      (1 - voicing * (0.5 - 0.4 * this.glottis.noiseModulation));
    return (
      colour *
      frication.gain *
      flow *
      this.shape.glottis.loudness *
      2.2 *
      this.head.fricationLevel
    );
  }

  /** Queue one solver step with the sources of this instant. */
  #step(queue) {
    const white = this.noise.white();
    const aspiration = this.noise.aspiration.process(white);
    const source = this.glottis.step(
      this.stepDuration,
      this.shape.glottis,
      aspiration
    );
    const noise = this.#fricationNoise(this.noise.white());
    queue(source, this.shape.frication.position, noise);
    this.steps++;
  }

  /**
   * Run the sources and the shapes for the next samples and queue the
   * solver steps they need. Each sample interpolates between two step
   * outputs: index 0 and 1 are the last two of the previous call, the
   * steps of this call follow.
   */
  #record(target, queue) {
    this.steps = 0;
    this.rates = [];
    const samples = {
      previous: new Int32Array(target.length),
      current: new Int32Array(target.length),
      fraction: new Float64Array(target.length),
      count: 0,
    };
    let previous = 0;
    let current = 1;
    const outputStep = 1 / this.sampleRate;
    let written = 0;
    while (written < target.length && !this.done) {
      const offset = this.position % this.blockSize;
      if (offset === 0 || !this.shape) {
        this.#updateShape();
      }
      const blockEnd = Math.min(
        target.length,
        written + this.blockSize - offset,
        written + this.totalSamples - this.position
      );
      for (; written < blockEnd; written++, this.position++) {
        while (this.solverTime <= this.time) {
          previous = current;
          current = 2 + this.steps;
          this.#step(queue);
          this.solverTime += this.stepDuration;
        }
        samples.previous[written] = previous;
        samples.current[written] = current;
        samples.fraction[written] =
          1 - (this.solverTime - this.time) / this.stepDuration;
        this.time += outputStep;
      }
    }
    samples.count = written;
    return samples;
  }

  /**
   * Filter the solver outputs at the rate of the block that queued them,
   * then resample them to the audio rate and finish the samples.
   */
  #finish(target, samples, outputs) {
    const values = new Float64Array(outputs.length + 2);
    values[0] = this.previous;
    values[1] = this.current;
    const { rates } = this;
    let next = 0;
    for (let step = 0; step <= outputs.length; step++) {
      for (; next < rates.length && rates[next] <= step; next += 2) {
        this.output.configure(rates[next + 1]);
      }
      if (step < outputs.length) {
        values[step + 2] = this.output.filter(outputs[step]);
      }
    }
    for (let index = 0; index < samples.count; index++) {
      const previous = values[samples.previous[index]];
      const current = values[samples.current[index]];
      const value = previous + (current - previous) * samples.fraction[index];
      target[index] = this.output.finish(
        this.listener ? this.listener.process(value) : value
      );
    }
    if (samples.count > 0) {
      this.previous = values[samples.previous[samples.count - 1]];
      this.current = values[samples.current[samples.count - 1]];
    }
    return samples.count;
  }

  /**
   * Render the next samples into `target`. Blocks are aligned to the
   * absolute sample position, so any chunking gives identical audio.
   * @param {Float32Array} target
   * @returns {number} Number of samples written (less than target.length at the end).
   */
  render(target) {
    const outputs = [];
    const samples = this.#record(target, (...step) =>
      outputs.push(this.solver.step(...step))
    );
    return this.#finish(target, samples, outputs);
  }

  /**
   * render() for solvers that queue their steps (the 3D solver on the
   * GPU): the steps of the whole call run together. Gives the same audio
   * as render() for the other solvers.
   * @param {Float32Array} target
   * @param {{field?: boolean}} [options] Passed to the solver's flushSteps.
   * @returns {Promise<number>}
   */
  async renderAsync(target, options = {}) {
    const { solver } = this;
    if (!solver.queueStep) {
      return this.render(target);
    }
    const samples = this.#record(target, (...step) =>
      solver.queueStep(...step)
    );
    const outputs = await solver.flushSteps(options);
    return this.#finish(target, samples, outputs);
  }
}

/**
 * Render a whole plan offline.
 * @param {object} plan
 * @param {ConstructorParameters<typeof VoiceRenderer>[1]} [options]
 * @returns {Float32Array}
 */
export function renderPlan(plan, options = {}) {
  const renderer = new VoiceRenderer(plan, options);
  const samples = new Float32Array(renderer.totalSamples);
  renderer.render(samples);
  return samples;
}

/**
 * Render a whole plan offline with renderAsync, `chunkSize` samples at a
 * time (needed for the GPU solver).
 * @param {object} plan
 * @param {ConstructorParameters<typeof VoiceRenderer>[1] & {chunkSize?: number}} [options]
 * @returns {Promise<Float32Array>}
 */
export async function renderPlanAsync(plan, options = {}) {
  const renderer = new VoiceRenderer(plan, options);
  const samples = new Float32Array(renderer.totalSamples);
  const chunkSize = options.chunkSize ?? 4096;
  for (let start = 0; start < samples.length; start += chunkSize) {
    await renderer.renderAsync(samples.subarray(start, start + chunkSize));
  }
  return samples;
}
