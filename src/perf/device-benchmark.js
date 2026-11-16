/**
 * The silent device benchmark (issue 28): measures, in small slices of CPU
 * time and within a fixed budget, how fast this device renders each audio
 * tier, and picks the most precise tier that keeps 20 % of the time free.
 *
 * It is made to run in the background while the app loads: it never makes
 * a sound, pauses (`await pause()`) at least every `slice` seconds so
 * messages can be handled in between, stops before `budget` seconds of CPU
 * time are spent, and returns at once with a partial result when `paused()`
 * says that speech is waiting; a later call with `resume` continues it.
 */

import { releaseRenderer } from '../acoustics/voice.js';
import { createEngine } from '../engine/index.js';
import { benchmarkRenderer } from './benchmark.js';
import { AUDIO_TIERS, BASE_AUDIO_LEVEL, audioTierIndex } from './lod.js';

/** Version of the procedure below: add 1 whenever it changes. */
export const BENCHMARK_VERSION = 1;

/** Samples rendered per block. */
const BLOCK = 512;
/** Seconds of audio of the warm-up render (tier 0, not counted). */
const WARMUP_SECONDS = 0.03;
/** Estimated seconds to build the voxel model of a 3D tier. */
const FDTD_SETUP = 0.2;
/** Share of the target a predicted (not measured) load may use. */
const PREDICTED_MARGIN = 0.7;
/** The skip rule of chooseTier: a tier predicted above 2 × target is not run. */
const SKIP = 2;

/**
 * The level automatic quality starts at before the benchmark has chosen:
 * `narrowband` on a device with at most 2 cores or 2 GB of memory, else
 * `minimal` (BASE_AUDIO_LEVEL). Missing values count as large.
 * @param {{hardwareConcurrency?: number, deviceMemory?: number}} [hints]
 *   the fields of `navigator`
 * @returns {number}
 */
export function startLevel(hints = {}) {
  const small = (value) => typeof value === 'number' && value <= 2;
  return small(hints.hardwareConcurrency) || small(hints.deviceMemory)
    ? audioTierIndex('narrowband')
    : BASE_AUDIO_LEVEL;
}

/**
 * The highest level automatic quality may use on battery: `medium` when the
 * battery (the answer of `navigator.getBattery()`) is not charging and below
 * 20 %, else the last tier.
 * @param {{charging?: boolean, level?: number}|null} [battery]
 * @returns {number}
 */
export function batteryLevelCap(battery) {
  return battery?.charging === false && battery.level < 0.2
    ? audioTierIndex('medium')
    : AUDIO_TIERS.length - 1;
}

/**
 * The highest level whose load is at most `target` when measured, or at
 * most 0.7 × `target` when predicted, with every lower level passing too;
 * 0 when none does.
 * @param {number[]} loads
 * @param {boolean[]} measured
 * @param {number} [target]
 * @returns {number}
 */
export function chooseLevel(loads, measured, target = 0.8) {
  let level = 0;
  for (let index = 0; index < loads.length; index++) {
    const limit = measured[index] ? target : PREDICTED_MARGIN * target;
    if (!(loads[index] <= limit)) {
      break;
    }
    level = index;
  }
  return level;
}

/** Thrown inside a probe when `paused()` says speech is waiting. */
const INTERRUPTED = Symbol('interrupted');

/**
 * Splits the work into slices: counts their length (CPU seconds) and pauses
 * between them.
 */
class Slicer {
  constructor(options, previous) {
    this.now = options.now;
    this.pauseFn = options.pause;
    this.paused = options.paused;
    this.slice = options.slice;
    this.cpuSeconds = previous?.cpuSeconds ?? 0;
    this.longestSlice = previous?.longestSlice ?? 0;
    this.mark = this.now();
  }

  /** Seconds since the slice began. */
  get current() {
    return Math.max(0, (this.now() - this.mark) / 1000);
  }

  /** CPU seconds spent, the open slice included. */
  get spent() {
    return this.cpuSeconds + this.current;
  }

  /** Close the open slice. */
  close() {
    const length = this.current;
    this.cpuSeconds += length;
    this.longestSlice = Math.max(this.longestSlice, length);
  }

  /** End the slice and pause; throws INTERRUPTED when speech waits. */
  async pause() {
    this.close();
    await this.pauseFn();
    this.mark = this.now();
    if (this.paused()) {
      throw INTERRUPTED;
    }
  }

  /** Pause when the slice is full. */
  async check() {
    if (this.current >= this.slice) {
      await this.pause();
    }
  }

  /** Pause when anything ran since the last pause. */
  async boundary() {
    if (this.now() > this.mark) {
      await this.pause();
    }
  }
}

/**
 * Render one probe: create the renderer (a slice of its own), then render
 * blocks until `seconds` of audio are done or the render time exceeds
 * `limit` × `seconds`.
 * @returns {Promise<number>} the load (render time / audio time)
 */
async function probe(context, tier, index, seconds, warmup) {
  const { slicer, now } = context;
  await slicer.boundary();
  const renderer = context.measure(tier, {
    warmup,
    index,
    seconds,
    head: context.head,
    engine: context.engine,
  });
  try {
    await slicer.pause();
    const block = new Float32Array(BLOCK);
    const wanted = seconds * renderer.sampleRate;
    let renderTime = 0;
    let rendered = 0;
    for (;;) {
      const began = now();
      const count = renderer.render(block);
      renderTime += (now() - began) / 1000;
      rendered += count;
      const over = renderTime > context.limit * seconds;
      if (count === 0 || renderer.done || rendered >= wanted || over) {
        break;
      }
      await slicer.check();
    }
    return rendered > 0 ? renderTime / (rendered / renderer.sampleRate) : 0;
  } finally {
    releaseRenderer(renderer);
  }
}

/** The default `measure`: a renderer of the benchmark utterance. */
function measureTier(tier, { seconds, head, engine }) {
  return benchmarkRenderer(tier, { seconds, head, engine });
}

/** Load predicted for tier `index` from the tier below. */
function predictLoad(tiers, loads, index) {
  return (loads[index - 1] * tiers[index].cost) / tiers[index - 1].cost;
}

/** Whether tier `index` is to be measured; false stops the walk. */
function shouldMeasure(context, loads, index) {
  const { tiers, target } = context;
  if (index === 0) {
    // Always measured: there is nothing to predict tier 0 from.
    return true;
  }
  const predicted = predictLoad(tiers, loads, index);
  if (predicted > SKIP * target) {
    return false;
  }
  const setup = tiers[index].solver === 'fdtd3d' ? FDTD_SETUP : 0;
  const estimate = predicted * context.probe + setup;
  return context.slicer.spent + estimate <= context.budget;
}

/** The result object of benchmarkDevice. */
function result(context, loads, measured, partial) {
  const { slicer, engine, tiers } = context;
  slicer.close();
  slicer.mark = slicer.now();
  const level =
    loads.length > 0 ? chooseLevel(loads, measured, context.target) : 0;
  return {
    version: BENCHMARK_VERSION,
    engine: { name: engine.name, simd: engine.simd, threads: engine.threads },
    level,
    tier: tiers[level],
    loads,
    measured,
    cpuSeconds: slicer.cpuSeconds,
    longestSlice: slicer.longestSlice,
    partial,
  };
}

/** Measure the tiers from `loads.length` up (see benchmarkDevice). */
async function walk(context, loads, measured) {
  const { tiers, maxLevel, target } = context;
  for (let index = loads.length; index <= maxLevel; index++) {
    if (!shouldMeasure(context, loads, index)) {
      break;
    }
    const load = await probe(
      context,
      tiers[index],
      index,
      context.probe,
      false
    );
    loads.push(load);
    measured.push(true);
    if (load > target) {
      break;
    }
  }
  for (let index = loads.length; index <= maxLevel; index++) {
    loads.push(predictLoad(tiers, loads, index));
    measured.push(false);
  }
}

/**
 * Measure how fast this device renders each audio tier and choose the most
 * precise one that keeps 20 % of the time free (see the module comment).
 *
 * The walk is the one of chooseTier: from tier 0 up, a tier whose load
 * predicted from the tier below (load × cost ratio) is above 2 × `target`
 * is not measured, and the walk stops after the first load above
 * `target`. It also stops before a tier whose estimated cost (predicted
 * load × `probe`, plus 0.2 s for the voxel model of a 3D tier) would take
 * the CPU time above `budget`. Tiers not measured get the load predicted
 * from the tier below and `measured[i] = false`. Before the first tier,
 * 0.03 s of tier 0 are rendered and dropped (cold code is several times
 * slower).
 * @param {object} [options]
 * @param {'auto'|'rust'|'js'|object} [options.engine] default 'auto' (createEngine)
 * @param {object} [options.head]
 * @param {number} [options.target] largest load of a chosen tier (0.8)
 * @param {number} [options.budget] CPU seconds (1)
 * @param {number} [options.slice] seconds between pauses (0.02)
 * @param {number} [options.probe] seconds of audio per tier (0.06)
 * @param {number} [options.maxLevel] last tier to consider (the last one)
 * @param {object} [options.resume] a partial result to continue
 * @param {() => boolean} [options.paused] true when speech is waiting
 * @param {() => number} [options.now] clock in ms (performance.now)
 * @param {() => Promise<void>} [options.pause] default setTimeout 0
 * @param {(tier: object, info: {warmup: boolean, index: number, seconds: number, head?: object, engine: object}) => {sampleRate: number, render: (block: Float32Array) => number, done?: boolean}} [options.measure]
 *   makes the renderer of a probe (tests)
 * @param {readonly object[]} [options.tiers] default AUDIO_TIERS
 * @returns {Promise<{version: number, engine: {name: string, simd: boolean, threads: number}, level: number, tier: object, loads: number[], measured: boolean[], cpuSeconds: number, longestSlice: number, partial: boolean}>}
 */
export async function benchmarkDevice(options = {}) {
  const context = await createContext(options);
  // A partial result holds measured loads only.
  const loads = (options.resume?.loads ?? []).slice(0, context.maxLevel + 1);
  const measured = loads.map(() => true);
  try {
    // A resumed walk follows speech, which has warmed the code up.
    if (loads.length === 0) {
      await probe(context, context.tiers[0], 0, WARMUP_SECONDS, true);
    }
    await walk(context, loads, measured);
  } catch (error) {
    if (error !== INTERRUPTED) {
      throw error;
    }
    return result(context, loads, measured, true);
  }
  return result(context, loads, measured, false);
}

/** The options of benchmarkDevice with their defaults, and the slicer. */
async function createContext(options) {
  const engine = await createEngine(options.engine ?? 'auto');
  const tiers = options.tiers ?? AUDIO_TIERS;
  const target = options.target ?? 0.8;
  const now = options.now ?? (() => globalThis.performance.now());
  const pause =
    options.pause ??
    (() => new Promise((resolve) => globalThis.setTimeout(resolve, 0)));
  const slicer = new Slicer(
    {
      now,
      pause,
      slice: options.slice ?? 0.02,
      paused: options.paused ?? (() => false),
    },
    options.resume
  );
  return {
    tiers,
    target,
    head: options.head,
    budget: options.budget ?? 1,
    probe: options.probe ?? 0.06,
    maxLevel: Math.min(options.maxLevel ?? tiers.length - 1, tiers.length - 1),
    limit: SKIP * target,
    measure: options.measure ?? measureTier,
    engine,
    now,
    slicer,
  };
}
