/**
 * Measure how much of the real-time budget each audio tier needs on this
 * machine (load = simulation time / audio duration).
 */

import { renderPlan } from '../acoustics/voice.js';
import { buildVoxelModel } from '../acoustics/voxel-model.js';
import { planUtterance } from '../articulation/plan.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import { AUDIO_TIERS, chooseTier } from './lod.js';

const BENCHMARK_IPA = 'ˈhæloʊ ˈwɜːld';

/**
 * Load of one audio tier (work seconds per audio second).
 * @param {object} tier Entry of AUDIO_TIERS.
 * @param {{head?: object, ipa?: string, seconds?: number}} [options]
 */
export function measureAudioTier(tier, options = {}) {
  const head = normalizeHeadConfig(options.head ?? DEFAULT_HEAD);
  const plan = planUtterance(options.ipa ?? BENCHMARK_IPA, { head });
  const seconds = Math.min(plan.duration, options.seconds ?? 0.3);
  const model =
    tier.solver === 'fdtd3d' ? buildVoxelModel(head, { dx: tier.dx }) : null;
  const short = { ...plan, duration: seconds };
  const start = globalThis.performance.now();
  renderPlan(short, { ...tier, head, model });
  const elapsed = (globalThis.performance.now() - start) / 1000;
  return elapsed / seconds;
}

/**
 * Benchmark the audio tiers from cheapest up and pick the best that fits.
 * @param {{target?: number, head?: object, seconds?: number}} [options]
 * @returns {{level: number, tier: object, loads: number[]}}
 */
export function benchmarkAudioTiers(options = {}) {
  const { level, loads } = chooseTier(
    (tier) => measureAudioTier(tier, options),
    { tiers: AUDIO_TIERS, target: options.target }
  );
  return { level, tier: AUDIO_TIERS[level], loads };
}
