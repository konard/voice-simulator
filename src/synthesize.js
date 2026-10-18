/**
 * High-level API: text -> IPA -> articulation plan -> physically simulated
 * audio, offline or as a stream of chunks.
 */

import {
  renderPlan,
  renderPlanAsync,
  VoiceRenderer,
} from './acoustics/voice.js';
import { planUtterance } from './articulation/plan.js';
import { utteranceTimeline } from './articulation/timeline.js';
import { textToIpa } from './g2p/index.js';
import { normalizeHeadConfig, randomHeadConfig } from './head-config.js';
import { AUDIO_TIERS, DEFAULT_AUDIO_TIER } from './perf/lod.js';

/**
 * Find an audio tier by name or index.
 * @param {string|number|undefined} tier
 */
export function getAudioTier(tier) {
  if (tier === undefined || tier === null) {
    return null;
  }
  const found =
    typeof tier === 'number'
      ? AUDIO_TIERS[tier]
      : AUDIO_TIERS.find((entry) => entry.name === tier);
  if (!found) {
    throw new Error(`Unknown audio tier: ${tier}`);
  }
  return found;
}

function resolveHead(head, seed, preset) {
  if (head === 'random') {
    return randomHeadConfig(seed ?? Date.now(), { preset });
  }
  return normalizeHeadConfig(head);
}

/**
 * Prepare everything needed to render: IPA, plan and renderer options.
 * @param {string} text Text (or IPA when `options.ipa` is true).
 * @param {object} [options]
 */
export function prepareUtterance(text, options = {}) {
  const head = resolveHead(options.head, options.seed, options.preset);
  const transcription = options.ipa
    ? { lang: options.lang ?? 'ipa', ipa: String(text), words: [] }
    : textToIpa(text, { lang: options.lang, accent: options.accent });
  const plan = planUtterance(transcription.ipa, {
    head,
    language: transcription.lang,
  });
  const timeline = utteranceTimeline(plan, {
    words: transcription.words,
    ipa: transcription.ipa,
    language: transcription.lang,
  });
  // Without a tier or a solver the default (3D) tier applies; a solver
  // alone keeps its own defaults.
  const tier =
    getAudioTier(
      options.tier ?? (options.solver ? undefined : DEFAULT_AUDIO_TIER)
    ) ?? {};
  const renderOptions = {
    solver: options.solver ?? tier.solver,
    sections: options.sections ?? tier.sections,
    dx: options.dx ?? tier.dx,
    sampleRate: options.sampleRate ?? tier.sampleRate ?? 48000,
    output: options.output,
    model: options.model,
    seed: options.seed ?? 1,
    head,
    microphone: options.microphone,
    room: options.room,
    enclosure: options.enclosure,
    teeth: options.teeth,
    piriform: options.piriform,
    vallecula: options.vallecula,
    device: options.device,
  };
  return { ...transcription, head, plan, timeline, renderOptions };
}

/**
 * Synthesize speech from text. `microphone`, `room` and `enclosure` choose
 * where and in what space the voice is heard (see VoiceRenderer).
 * @param {string} text
 * @param {{lang?: string, accent?: string, ipa?: boolean, head?: object|'random', seed?: string|number, preset?: string, tier?: string|number, solver?: string, sections?: number, dx?: number, sampleRate?: number, output?: 'flow'|'microphone', microphone?: {distance?: number, azimuth?: number, elevation?: number, compensate?: boolean}, room?: string|object, enclosure?: {width: number, height: number, depth: number, absorption?: number, center?: number[]}, teeth?: boolean, piriform?: boolean, vallecula?: boolean}} [options]
 * @returns {{lang: string, accent: string|null, ipa: string, words: object[], head: object, plan: object, timeline: object, sampleRate: number, samples: Float32Array, duration: number}}
 */
export function synthesize(text, options = {}) {
  const prepared = prepareUtterance(text, options);
  return result(prepared, renderPlan(prepared.plan, prepared.renderOptions));
}

/**
 * synthesize() that can run the 3D solver on a WebGPU `device` (see
 * requestGpuDevice); without one it gives the same result as synthesize.
 * @param {string} text
 * @param {Parameters<typeof synthesize>[1] & {device?: object, chunkSize?: number}} [options]
 * @returns {Promise<ReturnType<typeof synthesize>>}
 */
export async function synthesizeAsync(text, options = {}) {
  const prepared = prepareUtterance(text, options);
  const samples = await renderPlanAsync(prepared.plan, {
    ...prepared.renderOptions,
    chunkSize: options.chunkSize,
  });
  return result(prepared, samples);
}

function result(prepared, samples) {
  const { sampleRate } = prepared.renderOptions;
  return {
    lang: prepared.lang,
    accent: prepared.accent ?? null,
    ipa: prepared.ipa,
    words: prepared.words,
    head: prepared.head,
    plan: prepared.plan,
    timeline: prepared.timeline,
    sampleRate,
    samples,
    duration: samples.length / sampleRate,
  };
}

/**
 * Synthesize speech incrementally. Chunks are produced as they are
 * simulated, so playback or network streaming can start immediately.
 * @param {string} text
 * @param {Parameters<typeof synthesize>[1] & {chunkSize?: number}} [options]
 * @returns {AsyncGenerator<Float32Array>}
 */
export async function* synthesizeStream(text, options = {}) {
  const prepared = prepareUtterance(text, options);
  const renderer = new VoiceRenderer(prepared.plan, prepared.renderOptions);
  const chunkSize = options.chunkSize ?? 4096;
  while (!renderer.done) {
    const chunk = new Float32Array(chunkSize);
    const written = await renderer.renderAsync(chunk);
    if (written === 0) {
      break;
    }
    yield chunk.subarray(0, written);
    // Let the event loop deliver the chunk before simulating the next one.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
}
