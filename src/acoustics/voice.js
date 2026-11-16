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
import {
  VOWEL_CORRECTIONS_2D,
  VOWEL_CORRECTIONS_3D,
} from '../articulation/vowel-calibration.js';
import { VOWEL_LENGTH_SCALE_3D } from '../articulation/vowel-space.js';
import {
  effortNoiseGain,
  effortTransientGain,
} from '../articulation/effort.js';
import { Biquad, createNoise } from './filters.js';
import { Glottis } from './glottis.js';
import {
  Aerodynamics,
  ASPIRATION_REFERENCE,
  FRICATION_REFERENCE,
  glottalArea,
  sourceStrength,
} from './aerodynamics.js';
import { IncidentPressure, VocalFolds, restArea } from './folds.js';
import { Subglottal } from './subglottal.js';
import { SPEED_OF_SOUND } from './transfer.js';
import { Waveguide } from './waveguide.js';
import { Fdtd2d } from './fdtd2d.js';
import { Fdtd3d } from './fdtd3d.js';
import { createListener, headListening } from './microphone.js';
import { enclosureBounds } from './voxel-model.js';
// A cycle (the engine makes VoiceRenderers), used at call time only.
import { createEngine, getEngine } from '../engine/index.js';

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

/**
 * Source-tract interaction when none is asked for (issue 34). It needs the
 * fold source and a solver that steps on the CPU; without them the default
 * leaves it off.
 */
export const DEFAULT_INTERACTION = false;

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
        head,
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
        glottalPressureCoefficient: head.glottalPressureCoefficient,
        breathGain: head.breathGain,
        breathExponent: head.breathExponent,
        reCritical: head.reCritical,
      }),
  ],
]);

/**
 * Vowel calibration of each solver (scripts/calibrate-vowels.mjs); the
 * others use the tube-model table.
 */
const VOWEL_TABLES = new Map([
  ['fdtd2d', VOWEL_CORRECTIONS_2D],
  ['fdtd3d', VOWEL_CORRECTIONS_3D],
]);
/** Length scale of each solver's vowel table (Fdtd3d's lengthScale). */
const LENGTH_SCALES = new Map([['fdtd3d', VOWEL_LENGTH_SCALE_3D]]);

/** Where Fdtd3d puts the source plane for a length (see #riseFor). */
function lengthScaleOf(options) {
  return options.lengthScale ?? LENGTH_SCALES.get(options.solver);
}

/** Solver factories by name: 1D waveguide, 2D and 3D FDTD. */
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
  ['fdtd2d', (options) => new Fdtd2d(options)],
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

/**
 * Sections of the nasal tract for an oral tract of `sections` sections.
 * @param {object} head Normalized head.
 * @param {number} sections
 */
export function noseSections(head, sections) {
  const nose = noseShape(head);
  return Math.max(
    6,
    Math.round((sections * nose.length) / head.vocalTractLength)
  );
}

/**
 * Tract shape of the control block that starts at `time` (s): samples the
 * plan into `state` (reused between calls) and shapes the tract. Shared by
 * VoiceRenderer and the Rust renderer (src/engine/rust-renderer.js), so
 * both see the same frames.
 * @param {object} plan
 * @param {number} time
 * @param {object} state
 * @param {object} head Normalized head.
 * @param {{sections: number, teeth: boolean, vowelCorrections?: object}} options
 */
export function blockShape(plan, time, state, head, options) {
  sampleState(plan, time, state);
  return tractShape(state, head, options);
}

export class NoiseSources {
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
 * @param {number} [strouhal] head.strouhal (STROUHAL by default).
 */
export function strouhalFrequency(flow, area, strouhal = STROUHAL) {
  if (!(area > 0)) {
    return STROUHAL_RANGE[0];
  }
  const frequency =
    (strouhal * (flow / area)) / Math.sqrt((4 * area) / Math.PI);
  return Math.min(STROUHAL_RANGE[1], Math.max(STROUHAL_RANGE[0], frequency));
}

/** Q of the biquads of a fourth-order Butterworth low-pass. */
const BUTTERWORTH_4 = [0.54, 1.31];
/** Q of the biquads of an eighth-order Butterworth low-pass. */
const BUTTERWORTH_8 = [0.5098, 0.6013, 0.9, 2.5629];

/**
 * Factor on the output gain of a level offset in dB (`levelOffsetDb` of
 * the render options): the headroom of loud speech modes (issue 52). It is
 * apart from `head.outputGain`, whose range is limited.
 * @param {number} [levelOffsetDb]
 */
export function levelFactor(levelOffsetDb = 0) {
  return levelOffsetDb ? 10 ** (levelOffsetDb / 20) : 1;
}

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
export class OutputStage {
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
   * @param {{sampleRate?: number, sections?: number, solver?: string, source?: 'lf' | 'folds', interaction?: boolean, subglottal?: boolean, seed?: string|number, blockSize?: number, bandLimit?: number, head?: object, dx?: number, model?: object, output?: string, kernel?: string, device?: object, microphone?: object, room?: string|object, enclosure?: object, teeth?: boolean, piriform?: boolean, vallecula?: boolean}} [options]
   *   `teeth: false` leaves out the incisors, `piriform: false` the
   *   piriform fossae (both solvers) and `vallecula: false` the vallecula
   *   (3D only). `source` is the voice source: 'lf' (default, LF pulses
   *   at the planned pitch) or 'folds' (two-mass vocal folds driven by the
   *   lung pressure, see folds.js). `blockSize` is the control interval in
   *   output samples (default 32) and `bandLimit` (Hz) switches the output
   *   low-pass to eighth order at min(bandLimit, 0.45 sampleRate), at the
   *   solver rate and again at the output rate. A WebGPU `device` runs the
   *   3D solver on the GPU; such a renderer renders with renderAsync.
   *   `interaction` (default DEFAULT_INTERACTION, fold source only) couples
   *   the folds to the waves of the vocal tract and, with `subglottal`
   *   (default: as `interaction`), of the trachea (subglottal.js): the
   *   glottal flow then feels the formants and the subglottal resonances,
   *   and the oral pressure of a closure slows it (issue 34). Without
   *   interaction `subglottal` has nothing to couple to and does nothing.
   */
  constructor(plan, options = {}) {
    this.plan = plan;
    this.head = normalizeHeadConfig(options.head ?? plan.head);
    // The head's microphone and room unless the options give their own.
    options = headListening(this.head, options);
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
      lengthScale: lengthScaleOf(options),
      microphone: options.microphone,
      enclosure: options.enclosure,
    });
    this.solver.setNose?.(noseShape(this.head).areas);
    this.#prepareInteraction(options);
    this.vowelCorrections = VOWEL_TABLES.get(options.solver ?? 'waveguide');
    this.glottis = source(this.head, seed);
    this.noise = new NoiseSources(seed);
    this.aerodynamics = new Aerodynamics({
      compliance: this.head.oralCompliance,
    });
    /** Last aerodynamic state (see aerodynamics.js) and source strengths. */
    this.airflow = null;
    this.fricationAmplitude = 0;
    this.transient = 0;
    this.transientStep = 0;
    this.output = new OutputStage(
      this.sampleRate,
      this.head.outputGain * levelFactor(options.levelOffsetDb),
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

  /**
   * Source-tract interaction: the solver's glottis reflects fully and the
   * folds take its load (and that of the trachea) at every step.
   */
  #prepareInteraction(options) {
    const coupled = Boolean(
      this.solver.glottalLoad && this.solver.setGlottalReflection
    );
    const asked = options.interaction;
    if (asked && this.source !== 'folds') {
      throw new Error("Interaction needs source: 'folds'");
    }
    if (asked && (!coupled || options.device)) {
      throw new Error('Interaction needs a solver that steps on the CPU');
    }
    this.interaction =
      asked ??
      (DEFAULT_INTERACTION &&
        this.source === 'folds' &&
        coupled &&
        !options.device);
    this.subglottal = null;
    if (!this.interaction) {
      return;
    }
    this.solver.setGlottalReflection(1);
    if (options.subglottal ?? true) {
      this.subglottal = new Subglottal(this.head);
    }
    this.tractPressure = new IncidentPressure();
    this.subglottalPressure = new IncidentPressure();
    this.load = {
      below: { pressure: 0, area: Infinity },
      above: { pressure: 0, area: Infinity },
    };
  }

  /** Load of the folds for the next step (see #prepareInteraction). */
  #glottalLoad() {
    const dt = this.stepDuration;
    const { below, above } = this.load;
    const tract = this.solver.glottalLoad();
    above.pressure = this.tractPressure.step(tract.incident, dt);
    above.area = tract.area;
    const { subglottal } = this;
    if (subglottal) {
      subglottal.configure(dt);
      below.pressure = this.subglottalPressure.step(subglottal.incident, dt);
      below.area = subglottal.area;
    }
    return this.load;
  }

  get done() {
    return this.position >= this.totalSamples;
  }

  #updateShape() {
    this.shape = blockShape(this.plan, this.time, this.state, this.head, {
      sections: this.sections,
      teeth: this.teeth,
      vowelCorrections: this.vowelCorrections,
    });
    this.solver.setShape(
      this.shape.areas,
      this.shape.velumArea,
      this.shape.velumIndex,
      this.shape.teeth,
      this.shape
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
        : glottalArea(
            glottis,
            this.head.breathiness,
            this.head.glottalChink,
            this.head
          );
    const constriction = frication.area + this.shape.velumArea;
    const air = this.aerodynamics.step(
      blockDuration,
      10 * (this.state.lungPressure ?? this.head.lungPressure),
      opening,
      constriction
    );
    this.airflow = air;
    glottis.oralPressure = air.oralPressure;
    const { reCritical } = this.head;
    // The effort raises the lung pressure; the noise follows its own rule.
    const noiseGain = effortNoiseGain(glottis.effort ?? 0);
    glottis.aspirationStrength =
      (sourceStrength(air.glottalDrop, opening, air.flow, reCritical) /
        ASPIRATION_REFERENCE) *
      noiseGain;
    const strength =
      sourceStrength(
        air.constrictionDrop,
        frication.area,
        air.flow,
        reCritical
      ) / FRICATION_REFERENCE;
    this.fricationAmplitude =
      frication.gain *
      this.head.fricationLevel *
      strength *
      this.head.fricationGain *
      noiseGain;
    if (this.fricationAmplitude > 1e-6) {
      this.noise.tune(
        strouhalFrequency(air.flow, constriction, this.head.strouhal)
      );
      const { obstacle } = frication;
      this.fricationAmplitude *=
        obstacle + this.head.wallSource * (1 - obstacle);
    }
    // The transient ramps from the last block's value to this one's. With
    // interaction the folds solve their flow from the lung and the oral
    // pressure, so the change of the mean flow is already in their source;
    // a second copy, from the folds' own mean area, closes a loop through
    // the tract to the folds that runs away in 3D, where the transient is
    // a pressure jump (issue 34).
    const target = this.interaction
      ? 0
      : air.flowDerivative *
        this.head.transientGain *
        effortTransientGain(glottis.effort ?? 0);
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
    const source = this.interaction
      ? this.glottis.step(
          this.stepDuration,
          this.shape.glottis,
          aspiration,
          this.#glottalLoad()
        )
      : this.glottis.step(this.stepDuration, this.shape.glottis, aspiration);
    // The flow into the tract leaves the trachea.
    this.subglottal?.step(-source);
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
 * Free what a renderer holds outside the garbage collector: the engine
 * memory of a Rust renderer and the GPU buffers of the 3D solver.
 */
export function releaseRenderer(renderer) {
  renderer.free?.();
  renderer.solver?.gpu?.destroy();
}

/**
 * Render a whole plan offline. `engine` (default `'auto'`) is an engine
 * name or an engine object of createEngine; the name is resolved with
 * getEngine (src/engine/index.js), so it is the Rust engine when it loads.
 * @param {object} plan
 * @param {ConstructorParameters<typeof VoiceRenderer>[1] & {engine?: 'auto'|'rust'|'js'|object, threads?: number|'auto', simd?: 'auto'|boolean}} [options]
 * @returns {Float32Array}
 */
export function renderPlan(plan, options = {}) {
  const renderer = getEngine(engineOptions(options)).createRenderer(
    plan,
    options
  );
  try {
    const samples = new Float32Array(renderer.totalSamples);
    renderer.render(samples);
    return samples;
  } finally {
    releaseRenderer(renderer);
  }
}

/** The options of createEngine in render options. */
export function engineOptions(options) {
  return {
    engine: options.engine,
    threads: options.threads,
    simd: options.simd,
  };
}

/**
 * Render a whole plan offline with renderAsync, `chunkSize` samples at a
 * time (needed for the GPU solver). `engine` as for renderPlan, resolved
 * with `await createEngine`.
 * @param {object} plan
 * @param {Parameters<typeof renderPlan>[1] & {chunkSize?: number}} [options]
 * @returns {Promise<Float32Array>}
 */
export async function renderPlanAsync(plan, options = {}) {
  const engine = await createEngine(engineOptions(options));
  const renderer = engine.createRenderer(plan, options);
  try {
    const samples = new Float32Array(renderer.totalSamples);
    const chunkSize = options.chunkSize ?? 4096;
    for (let start = 0; start < samples.length; start += chunkSize) {
      await renderer.renderAsync(samples.subarray(start, start + chunkSize));
    }
    return samples;
  } finally {
    // The renderer is not handed out: free its engine memory and GPU
    // buffers now, not when the garbage collector gets to them.
    releaseRenderer(renderer);
  }
}
