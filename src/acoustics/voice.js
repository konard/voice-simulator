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
import { Biquad, createNoise } from './filters.js';
import { Glottis } from './glottis.js';
import { SPEED_OF_SOUND } from './transfer.js';
import { Waveguide } from './waveguide.js';
import { Fdtd3d } from './fdtd3d.js';
import { createListener } from './microphone.js';
import { enclosureBounds } from './voxel-model.js';

const OUTPUT_GAIN = 0.3;

/** Solver factories by name: 1D waveguide and 3D FDTD. */
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
  constructor(sampleRate) {
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
    return Math.tanh(output * OUTPUT_GAIN);
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
   * @param {{sampleRate?: number, sections?: number, solver?: string, seed?: string|number, blockSize?: number, head?: object, dx?: number, model?: object, output?: string, microphone?: object, room?: string|object, enclosure?: object, teeth?: boolean, piriform?: boolean}} [options]
   *   `teeth: false` leaves out the incisors, `piriform: false` the
   *   piriform fossae side branches of the waveguide.
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
      piriform: options.piriform,
      microphone: options.microphone,
      enclosure: options.enclosure,
    });
    this.solver.setNose?.(noseShape(this.head).areas);
    this.glottis = new Glottis({
      seed,
      tenseness: this.head.tenseness,
      breathiness: this.head.breathiness,
    });
    this.noise = new NoiseSources(seed);
    this.output = new OutputStage(this.sampleRate);
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
    });
    this.solver.setShape(
      this.shape.areas,
      this.shape.velumArea,
      this.shape.velumIndex,
      this.shape.teeth
    );
    this.stepDuration = this.solver.stepDuration(this.shape);
    const rate = 1 / this.stepDuration;
    this.noise.configure(rate);
    this.output.configure(rate);
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
    // source; without that obstacle only the broad wall source remains.
    const colour =
      broad * (1 - frication.obstacle) + hiss * 0.06 * frication.obstacle;
    const voicing = Math.min(1, this.shape.glottis.voicing);
    const flow =
      (1 - this.shape.glottis.closure) *
      (1 - voicing * (0.5 - 0.4 * this.glottis.noiseModulation));
    return colour * frication.gain * flow * this.shape.glottis.loudness * 2.2;
  }

  #step() {
    const white = this.noise.white();
    const aspiration = this.noise.aspiration.process(white);
    const source = this.glottis.step(
      this.stepDuration,
      this.shape.glottis,
      aspiration
    );
    const noise = this.#fricationNoise(this.noise.white());
    const value = this.solver.step(
      source,
      this.shape.frication.position,
      noise
    );
    return this.output.filter(value);
  }

  /**
   * Render the next samples into `target`. Blocks are aligned to the
   * absolute sample position, so any chunking gives identical audio.
   * @param {Float32Array} target
   * @returns {number} Number of samples written (less than target.length at the end).
   */
  render(target) {
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
          this.previous = this.current;
          this.current = this.#step();
          this.solverTime += this.stepDuration;
        }
        const fraction = 1 - (this.solverTime - this.time) / this.stepDuration;
        const value = this.previous + (this.current - this.previous) * fraction;
        target[written] = this.output.finish(
          this.listener ? this.listener.process(value) : value
        );
        this.time += outputStep;
      }
    }
    return written;
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
