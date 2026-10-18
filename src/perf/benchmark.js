/**
 * Measure how much of the real-time budget each audio tier needs on this
 * machine (load = simulation time / audio duration).
 */

import { VoiceRenderer } from '../acoustics/voice.js';
import { buildVoxelModel } from '../acoustics/voxel-model.js';
import { planUtterance } from '../articulation/plan.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import { AUDIO_TIERS, chooseTier, chooseTierWithGpu } from './lod.js';

const BENCHMARK_IPA = 'ˈhæloʊ ˈwɜːld';

/** Samples rendered between checks of the time limit. */
const BLOCK = 512;

/** Renderer for the first `seconds` of the benchmark utterance. */
function benchmarkRenderer(tier, options) {
  const head = normalizeHeadConfig(options.head ?? DEFAULT_HEAD);
  const plan = planUtterance(options.ipa ?? BENCHMARK_IPA, { head });
  const seconds = Math.min(plan.duration, options.seconds ?? 0.3);
  const model =
    tier.solver === 'fdtd3d' ? buildVoxelModel(head, { dx: tier.dx }) : null;
  return new VoiceRenderer(
    { ...plan, duration: seconds },
    { ...tier, head, model, device: options.device }
  );
}

/**
 * Render until done or `limit` times the audio duration is spent.
 * @returns {Promise<number>|number} The load.
 */
function timeRendering(renderer, options, renderBlock) {
  const seconds = renderer.totalSamples / renderer.sampleRate;
  const budget = (options.limit ?? Infinity) * seconds;
  const start = globalThis.performance.now();
  let rendered = 0;
  let elapsed = 0;
  const load = () => elapsed / Math.max(rendered / renderer.sampleRate, 1e-9);
  const step = (count) => {
    rendered += count;
    elapsed = (globalThis.performance.now() - start) / 1000;
    return count > 0 && !renderer.done && elapsed <= budget;
  };
  return renderBlock(step, load);
}

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
  const renderer = benchmarkRenderer(tier, options);
  const block = new Float32Array(BLOCK);
  return timeRendering(renderer, options, (step, load) => {
    while (step(renderer.render(block))) {
      // Render the next block.
    }
    return load();
  });
}

/**
 * measureAudioTier on the backend the app would use: with a WebGPU
 * `device` the 3D tiers run on the GPU, `chunk` samples per dispatch as
 * when streaming. One chunk is rendered before the clock starts, so the
 * shader compilation does not count as load.
 * @param {object} tier Entry of AUDIO_TIERS.
 * @param {Parameters<typeof measureAudioTier>[1] & {device?: object, chunk?: number}} [options]
 * @returns {Promise<number>}
 */
export async function measureAudioTierAsync(tier, options = {}) {
  const renderer = benchmarkRenderer(tier, {
    ...options,
    device: tier.solver === 'fdtd3d' ? options.device : undefined,
  });
  const block = new Float32Array(
    renderer.solver.gpu ? (options.chunk ?? 1024) : BLOCK
  );
  try {
    if (renderer.solver.gpu) {
      await renderer.renderAsync(new Float32Array(block.length));
    }
    return await timeRendering(renderer, options, async (step, load) => {
      while (step(await renderer.renderAsync(block))) {
        // Render the next chunk.
      }
      return load();
    });
  } finally {
    renderer.solver.gpu?.destroy();
  }
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

/**
 * benchmarkAudioTiers for the backend the app would use: with a WebGPU
 * `device`, the 3D tiers above the CPU's choice are measured on the GPU
 * too (chooseTierWithGpu), so the result is the most detailed tier this
 * machine renders in real time with the target's headroom, on either.
 * @param {Parameters<typeof benchmarkAudioTiers>[0] & {device?: object}} [options]
 * @returns {Promise<ReturnType<typeof benchmarkAudioTiers> & {gpu: boolean, gpuLoads: (number|null)[]}>}
 */
export async function benchmarkAudioTiersAsync(options = {}) {
  const result = await chooseTierWithGpu(
    (tier, { limit, gpu }) =>
      measureAudioTierAsync(tier, {
        limit,
        ...options,
        device: gpu ? options.device : undefined,
      }),
    { tiers: AUDIO_TIERS, target: options.target, gpu: Boolean(options.device) }
  );
  return { ...result, tier: AUDIO_TIERS[result.level] };
}
