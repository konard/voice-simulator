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

/** Audio tiers, cheapest first. `cost` is relative work per second. */
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
    cost: 60,
  }),
  Object.freeze({
    name: 'ultra',
    solver: 'fdtd3d',
    dx: 0.6,
    sampleRate: 48000,
    cost: 300,
  }),
]);

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
      let level = this.level - 1;
      while (level > 0 && this.predict(level) > this.target) {
        level--;
      }
      return this.#switch(level);
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
 * Pick the most detailed tier whose measured load fits the target.
 * @param {(tier: object) => number} measure Returns the load of a tier (work time / real time).
 * @param {{tiers?: readonly object[], target?: number}} [options]
 * @returns {{level: number, loads: number[]}}
 */
export function chooseTier(measure, options = {}) {
  const tiers = options.tiers ?? AUDIO_TIERS;
  const target = options.target ?? 0.8;
  const loads = [];
  let level = 0;
  for (let index = 0; index < tiers.length; index++) {
    const load = measure(tiers[index]);
    loads.push(load);
    if (load > target) {
      break;
    }
    level = index;
  }
  return { level, loads };
}
