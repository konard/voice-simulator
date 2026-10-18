/**
 * Levels of detail and an adaptive governor.
 *
 * Audio and visuals each get a ladder of tiers ordered by cost. The
 * governor watches the measured load (time spent / time available, e.g.
 * render time of an audio block divided by its duration) and keeps it
 * at or below the target (0.8 = 20% headroom): it steps down as soon as
 * the smoothed load exceeds the target and steps up only when the next
 * tier is predicted to fit with margin, after a dwell time, so it does
 * not oscillate.
 */

/**
 * Audio tiers, cheapest first. `cost` is relative work per second, as
 * measured by experiments/issue-5-tier-costs.mjs (with the wasm kernel).
 */
export const AUDIO_TIERS = Object.freeze([
  Object.freeze({
    name: 'minimal',
    solver: 'waveguide',
    sections: 22,
    sampleRate: 22050,
    cost: 1,
  }),
  Object.freeze({
    name: 'low',
    solver: 'waveguide',
    sections: 32,
    sampleRate: 32000,
    cost: 1.6,
  }),
  Object.freeze({
    name: 'medium',
    solver: 'waveguide',
    sections: 44,
    sampleRate: 48000,
    cost: 2.6,
  }),
  Object.freeze({
    name: 'high',
    solver: 'fdtd3d',
    dx: 1,
    sampleRate: 48000,
    cost: 10,
  }),
  Object.freeze({
    name: 'ultra',
    solver: 'fdtd3d',
    dx: 0.6,
    sampleRate: 48000,
    cost: 65,
  }),
  Object.freeze({
    name: 'studio',
    solver: 'fdtd3d',
    dx: 0.5,
    sampleRate: 48000,
    cost: 105,
  }),
  Object.freeze({
    name: 'reference',
    solver: 'fdtd3d',
    dx: 0.4,
    sampleRate: 48000,
    cost: 220,
  }),
]);

/**
 * Tier used when none is asked for: full 3D acoustics at 0.5 cm cells,
 * which resolve the incisors, the pouches and transverse modes to well
 * above 5 kHz. It renders slower than real time on today's CPUs, so the
 * app renders ahead; 'medium' is the real-time waveguide of earlier
 * versions.
 */
export const DEFAULT_AUDIO_TIER = 'studio';

/** Visual tiers: head mesh LOD, tube rings and pressure field points. */
export const VISUAL_TIERS = Object.freeze([
  Object.freeze({ name: 'minimal', meshLod: 0, field: false, cost: 1 }),
  Object.freeze({ name: 'low', meshLod: 1, field: false, cost: 1.5 }),
  Object.freeze({ name: 'medium', meshLod: 2, field: true, cost: 2.5 }),
  Object.freeze({ name: 'high', meshLod: 3, field: true, cost: 4 }),
]);

export class LodGovernor {
  /**
   * @param {{tiers?: readonly {cost: number}[], level?: number, target?: number, smoothing?: number, margin?: number, dwell?: number, maxLevel?: number}} [options]
   */
  constructor(options = {}) {
    this.tiers = options.tiers ?? AUDIO_TIERS;
    this.target = options.target ?? 0.8;
    this.smoothing = options.smoothing ?? 0.2;
    this.margin = options.margin ?? 0.85;
    this.dwell = options.dwell ?? 20;
    this.maxLevel = options.maxLevel ?? this.tiers.length - 1;
    this.level = Math.min(this.maxLevel, options.level ?? 0);
    this.load = 0;
    this.samples = 0;
  }

  get tier() {
    return this.tiers[this.level];
  }

  /** Predicted load if the given level were active. */
  predict(level) {
    return (this.load * this.tiers[level].cost) / this.tier.cost;
  }

  #switch(level) {
    this.load = this.predict(level);
    this.level = level;
    this.samples = 0;
    return true;
  }

  /**
   * Report one measurement.
   * @param {number} busy Seconds spent working.
   * @param {number} budget Seconds available (e.g. audio block duration).
   * @returns {boolean} Whether the level changed.
   */
  record(busy, budget) {
    const load = busy / Math.max(budget, 1e-9);
    this.load =
      this.samples === 0
        ? load
        : this.load + (load - this.load) * this.smoothing;
    this.samples++;
    if (this.load > this.target && this.level > 0) {
      return this.#switch(
        fallbackLevel(this.tiers, this.level, this.load, this.target)
      );
    }
    const next = this.level + 1;
    if (
      next <= this.maxLevel &&
      this.samples >= this.dwell &&
      this.predict(next) < this.target * this.margin
    ) {
      return this.#switch(next);
    }
    return false;
  }
}

/**
 * Most detailed tier below `level` that is predicted (by cost ratio) to fit
 * the target, given the load measured at `level`; 0 if none does.
 * @param {readonly {cost: number}[]} tiers
 * @param {number} level
 * @param {number} load
 * @param {number} [target]
 */
export function fallbackLevel(tiers, level, load, target = 0.8) {
  let next = Math.max(0, level - 1);
  while (next > 0 && (load * tiers[next].cost) / tiers[level].cost > target) {
    next--;
  }
  return next;
}

/**
 * Pick the most detailed tier whose measured load fits the target.
 *
 * To find the limit of slow hardware quickly, a tier whose load predicted
 * from the cheaper tier (load times cost ratio) exceeds `skip` times the
 * target is not measured at all, and `measure` receives a `limit`: it may
 * stop as soon as the load is clearly above it.
 * @param {(tier: object, options: {limit: number}) => number} measure Returns the load of a tier (work time / real time).
 * @param {{tiers?: readonly object[], target?: number, skip?: number}} [options]
 * @returns {{level: number, loads: number[], measured: boolean[]}}
 */
export function chooseTier(measure, options = {}) {
  const tiers = options.tiers ?? AUDIO_TIERS;
  const target = options.target ?? 0.8;
  const limit = target * (options.skip ?? 2);
  const loads = [];
  const measured = [];
  let level = 0;
  for (let index = 0; index < tiers.length; index++) {
    if (index > 0) {
      const ratio = tiers[index].cost / tiers[index - 1].cost;
      const predicted = loads[index - 1] * ratio;
      if (predicted > limit) {
        loads.push(predicted);
        measured.push(false);
        break;
      }
    }
    const load = measure(tiers[index], { limit });
    loads.push(load);
    measured.push(true);
    if (load > target) {
      break;
    }
    level = index;
  }
  return { level, loads, measured };
}

/**
 * Watches the first moments of an utterance and reports when the current
 * tier cannot keep up with real time, long before the listener would hear
 * gaps: the caller can restart the utterance on a cheaper tier while the
 * audio is still in the playback lead.
 */
export class OverloadDetector {
  /**
   * @param {{threshold?: number, minAudio?: number, maxAudio?: number}} [options]
   * threshold: load that counts as overload (1 = exactly real time);
   * minAudio/maxAudio: seconds of rendered audio during which to decide.
   */
  constructor(options = {}) {
    this.threshold = options.threshold ?? 1.2;
    this.minAudio = options.minAudio ?? 0.04;
    this.maxAudio = options.maxAudio ?? 0.3;
    this.busy = 0;
    this.audio = 0;
  }

  /** Overall load so far. */
  get load() {
    return this.busy / Math.max(this.audio, 1e-9);
  }

  /**
   * Report a rendered chunk.
   * @param {number} busy Seconds spent rendering.
   * @param {number} audio Seconds of audio produced.
   * @returns {boolean} Whether the tier is overloaded.
   */
  record(busy, audio) {
    this.busy += busy;
    this.audio += audio;
    return (
      this.audio >= this.minAudio &&
      this.audio <= this.maxAudio &&
      this.load > this.threshold
    );
  }
}
