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
import {
  Aerodynamics,
  ASPIRATION_REFERENCE,
  FRICATION_REFERENCE,
  glottalArea,
  sourceStrength,
} from './aerodynamics.js';
import { VocalFolds, restArea } from './folds.js';
import { SPEED_OF_SOUND } from './transfer.js';
import { Waveguide } from './waveguide.js';
import { Fdtd3d } from './fdtd3d.js';
import { createListener } from './microphone.js';
import { enclosureBounds } from './voxel-model.js';

const OUTPUT_GAIN = 0.3;

/**
 * Amplitude of the frication noise of a default voiceless fricative
 * (relative source strength 1, see aerodynamics.js). Tuned so that [s]
 * kept its level within 1 dB when the fixed gains were replaced (issue 35,
 * experiments/issue-35-frication-tuning.mjs).
 */
export const FRICATION_GAIN = 0.592;

/**
 * Amplitude of the wall source (the jet hitting the walls of the channel)
 * against the obstacle source (the jet hitting the incisors, Shadle 1985):
 * -15 dB.
 */
export const WALL_SOURCE = 0.18;

/**
 * Strouhal number of the jet: the turbulence noise peaks near
 * STROUHAL * velocity / diameter (Stevens 1998). The front cavity of the
 * tract shapes the rest of the spectrum.
 */
export const STROUHAL = 0.2;

/** Frequency range of the noise band-pass (Hz). */
const STROUHAL_RANGE = [500, 6000];

/**
 * Gain of the burst transient: the flow derivative (cm³/s²) at the release
 * of a stop enters the tract as a flow source at the constriction. Tuned
 * so that the first 3 ms of a plain [t] peak 0 to 6 dB (4.9 dB) above its
 * frication; the stronger frication of [tʰ] (wide open glottis) leaves its
 * burst 3.5 dB below it (experiments/issue-11-turbulence.mjs).
 */
export const TRANSIENT_GAIN = 5e-6;

/** Voice source used when none is asked for: the LF pulse model. */
export const DEFAULT_SOURCE = 'lf';

/** Voice sources by name: LF pulses or the two-mass vocal folds. */
const SOURCES = new Map([
  [
    'lf',
    (head, seed) =>
      new Glottis({
        seed,
        tenseness: head.tenseness,
        breathiness: head.breathiness,
        jitter: head.jitter,
        shimmer: head.shimmer,
        aspirationLevel: head.aspirationLevel,
        chink: head.glottalChink,
        lungPressure: head.lungPressure,
      }),
  ],
  [
    'folds',
    (head) =>
      new VocalFolds({
        breathiness: head.breathiness,
        aspirationLevel: head.aspirationLevel,
        foldLength: head.foldLength,
        foldMass: head.foldMass,
        foldStiffness: head.foldStiffness,
        foldDamping: head.foldDamping,
      }),
  ],
]);

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
    this.frication = new Biquad();
    this.rate = 0;
    this.frequency = 0;
  }

  configure(rate) {
    if (Math.abs(rate - this.rate) / rate < 0.01) {
      return;
    }
    this.rate = rate;
    this.aspiration.bandpass(800, 0.5, rate);
    this.frequency = 0;
  }

  /** Centre the frication band-pass on the jet's Strouhal frequency. */
  tune(frequency) {
    if (Math.abs(frequency - this.frequency) <= 1e-3 * frequency) {
      return;
    }
    this.frequency = frequency;
    this.frication.bandpass(frequency, 0.5, this.rate);
  }
}

/**
 * Peak frequency (Hz) of the turbulence noise of a jet of flow `flow`
 * (cm³/s) through `area` (cm²).
 * @param {number} flow
 * @param {number} area
 */
export function strouhalFrequency(flow, area) {
  if (!(area > 0)) {
    return STROUHAL_RANGE[0];
  }
  const frequency =
    (STROUHAL * (flow / area)) / Math.sqrt((4 * area) / Math.PI);
  return Math.min(STROUHAL_RANGE[1], Math.max(STROUHAL_RANGE[0], frequency));
}

/** Q of the biquads of a fourth-order Butterworth low-pass. */
const BUTTERWORTH_4 = [0.54, 1.31];
/** Q of the biquads of an eighth-order Butterworth low-pass. */
const BUTTERWORTH_8 = [0.5098, 0.6013, 0.9, 2.5629];

/**
 * Low-pass at the solver rate, DC blocker and soft limiter. Without a
 * `bandLimit` the low-pass is fourth order at 0.45 times the output rate
 * (at most 20 kHz). With one (Hz) it is eighth order at
 * min(bandLimit, 0.45 sampleRate), so little energy from above the output
 * Nyquist frequency folds back when the solver output is taken at the low
 * output rate. The same eighth-order low-pass then runs once more at the
 * output rate: there the bilinear transform puts 1.1 bandLimit near
 * Nyquist, about 60 dB down at 8 kHz, which the filter at the solver rate
 * (about 7 dB at 1.1 bandLimit) cannot reach.
 */
class OutputStage {
  constructor(sampleRate, gain = 1, bandLimit = undefined) {
    this.gain = OUTPUT_GAIN * gain;
    const narrow = bandLimit !== undefined && bandLimit !== null;
    this.qualities = narrow ? BUTTERWORTH_8 : BUTTERWORTH_4;
    this.lowpass = this.qualities.map(() => new Biquad());
    this.dcInput = 0;
    this.dcOutput = 0;
    this.dcCoefficient = 1 - (2 * Math.PI * 30) / sampleRate;
    this.cutoff = narrow
      ? Math.min(bandLimit, 0.45 * sampleRate)
      : Math.min(sampleRate * 0.45, 20000);
    this.rate = 0;
    this.band = narrow
      ? BUTTERWORTH_8.map((quality) =>
          new Biquad().lowpass(this.cutoff, quality, sampleRate)
        )
      : null;
  }

  configure(rate) {
    if (Math.abs(rate - this.rate) / rate < 0.01) {
      return;
    }
    this.rate = rate;
    this.qualities.forEach((quality, index) =>
      this.lowpass[index].lowpass(this.cutoff, quality, rate)
    );
  }

  filter(value) {
    let result = value;
    for (const filter of this.lowpass) {
      result = filter.process(result);
    }
    return result;
  }

  finish(input) {
    let value = input;
    if (this.band) {
      for (const filter of this.band) {
        value = filter.process(value);
      }
    }
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
   * @param {{sampleRate?: number, sections?: number, solver?: string, source?: 'lf' | 'folds', seed?: string|number, blockSize?: number, bandLimit?: number, head?: object, dx?: number, model?: object, output?: string, kernel?: string, device?: object, microphone?: object, room?: string|object, enclosure?: object, teeth?: boolean, piriform?: boolean, vallecula?: boolean}} [options]
   *   `teeth: false` leaves out the incisors, `piriform: false` the
   *   piriform fossae (both solvers) and `vallecula: false` the vallecula
   *   (3D only). `source` is the voice source: 'lf' (default, LF pulses
   *   at the planned pitch) or 'folds' (two-mass vocal folds driven by the
   *   lung pressure, see folds.js). `blockSize` is the control interval in
   *   output samples (default 32) and `bandLimit` (Hz) switches the output
   *   low-pass to eighth order at min(bandLimit, 0.45 sampleRate), at the
   *   solver rate and again at the output rate. A WebGPU `device` runs the
   *   3D solver on the GPU; such a renderer renders with renderAsync.
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
    this.source = options.source ?? DEFAULT_SOURCE;
    const source = SOURCES.get(this.source);
    if (!source) {
      throw new Error(`Unknown source: ${options.source}`);
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
    this.glottis = source(this.head, seed);
    this.noise = new NoiseSources(seed);
    this.aerodynamics = new Aerodynamics();
    /** Last aerodynamic state (see aerodynamics.js) and source strengths. */
    this.airflow = null;
    this.fricationAmplitude = 0;
    this.transient = 0;
    this.transientStep = 0;
    this.output = new OutputStage(
      this.sampleRate,
      this.head.outputGain,
      options.bandLimit
    );
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
    this.#updateAirflow(rate);
    // The output filter runs when the solver outputs arrive (see #finish).
    this.rates.push(this.steps, rate);
  }

  /**
   * Air flow of this control block: mouth pressure, flow, the strength of
   * the frication and aspiration sources and the burst transient.
   */
  #updateAirflow(rate) {
    const { frication, glottis } = this.shape;
    const blockDuration = this.blockSize / this.sampleRate;
    const opening =
      this.source === 'folds'
        ? this.#foldArea(glottis)
        : glottalArea(glottis, this.head.breathiness, this.head.glottalChink);
    const constriction = frication.area + this.shape.velumArea;
    const air = this.aerodynamics.step(
      blockDuration,
      10 * (this.state.lungPressure ?? this.head.lungPressure),
      opening,
      constriction
    );
    this.airflow = air;
    glottis.oralPressure = air.oralPressure;
    glottis.aspirationStrength =
      sourceStrength(air.glottalDrop, opening, air.flow) / ASPIRATION_REFERENCE;
    const strength =
      sourceStrength(air.constrictionDrop, frication.area, air.flow) /
      FRICATION_REFERENCE;
    this.fricationAmplitude =
      frication.gain * this.head.fricationLevel * strength * FRICATION_GAIN;
    if (this.fricationAmplitude > 1e-6) {
      this.noise.tune(strouhalFrequency(air.flow, constriction));
      const { obstacle } = frication;
      this.fricationAmplitude *= obstacle + WALL_SOURCE * (1 - obstacle);
    }
    // The transient ramps from the last block's value to this one's.
    const target = air.flowDerivative * TRANSIENT_GAIN;
    const steps = Math.max(1, blockDuration * rate);
    this.transientStep = (target - this.transient) / steps;
  }

  /**
   * Glottal area (cm²) of the fold source: the mean area of the folds, or
   * before their first step their rest area.
   */
  #foldArea(control) {
    if (this.glottis.started) {
      return this.glottis.meanArea;
    }
    const closure = Math.min(1, Math.max(0, control.closure));
    return Math.max(0, restArea(control.adduction)) * (1 - closure);
  }

  #fricationNoise(white) {
    const amplitude = this.fricationAmplitude;
    if (amplitude <= 1e-6) {
      return 0;
    }
    return this.noise.frication.process(white) * amplitude;
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
    let flow = 0;
    if (this.transientStep !== 0 || this.transient !== 0) {
      this.transient += this.transientStep;
      flow = this.transient;
    }
    queue(source, this.shape.frication.position, noise, flow);
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
  try {
    for (let start = 0; start < samples.length; start += chunkSize) {
      await renderer.renderAsync(samples.subarray(start, start + chunkSize));
    }
  } finally {
    // The renderer is not handed out: free its GPU buffers now, not when
    // the garbage collector gets to them.
    renderer.solver.gpu?.destroy();
  }
  return samples;
}
