/**
 * Measure how much of the real-time budget each audio tier needs on this
 * machine (load = simulation time / audio duration).
 */

import { VoiceRenderer } from '../acoustics/voice.js';
import { buildVoxelModel } from '../acoustics/voxel-model.js';
import { planUtterance } from '../articulation/plan.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import { AUDIO_TIERS, chooseTier } from './lod.js';

const BENCHMARK_IPA = 'ˈhæloʊ ˈwɜːld';

/** Samples rendered between checks of the time limit. */
const BLOCK = 512;

/**
 * Load of one audio tier (work seconds per audio second).
 *
 * With a `limit`, rendering stops as soon as the time spent exceeds
 * `limit` times the audio duration, so a tier that is far too slow for
 * this machine is detected after a fraction of the benchmark.
 * @param {object} tier Entry of AUDIO_TIERS.
 * @param {{head?: object, ipa?: string, seconds?: number, limit?: number}} [options]
 */
export function measureAudioTier(tier, options = {}) {
  const head = normalizeHeadConfig(options.head ?? DEFAULT_HEAD);
  const plan = planUtterance(options.ipa ?? BENCHMARK_IPA, { head });
  const seconds = Math.min(plan.duration, options.seconds ?? 0.3);
  const model =
    tier.solver === 'fdtd3d' ? buildVoxelModel(head, { dx: tier.dx }) : null;
  const renderer = new VoiceRenderer(
    { ...plan, duration: seconds },
    { ...tier, head, model }
  );
  const block = new Float32Array(BLOCK);
  const budget = (options.limit ?? Infinity) * seconds;
  const start = globalThis.performance.now();
  let rendered = 0;
  let elapsed = 0;
  while (!renderer.done && elapsed <= budget) {
    const count = renderer.render(block);
    if (count === 0) {
      break;
    }
    rendered += count;
    elapsed = (globalThis.performance.now() - start) / 1000;
  }
  return elapsed / Math.max(rendered / renderer.sampleRate, 1e-9);
}

/**
 * Benchmark the audio tiers from cheapest up and pick the best that fits.
 * @param {{target?: number, head?: object, seconds?: number}} [options]
 * @returns {{level: number, tier: object, loads: number[], measured: boolean[]}}
 */
export function benchmarkAudioTiers(options = {}) {
  const { level, loads, measured } = chooseTier(
    (tier, { limit }) => measureAudioTier(tier, { limit, ...options }),
    { tiers: AUDIO_TIERS, target: options.target }
  );
  return { level, tier: AUDIO_TIERS[level], loads, measured };
}
