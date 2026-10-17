/**
 * High-level API: text -> IPA -> articulation plan -> physically simulated
 * audio, offline or as a stream of chunks.
 */

import { renderPlan, VoiceRenderer } from './acoustics/voice.js';
import { planUtterance } from './articulation/plan.js';
import { textToIpa } from './g2p/index.js';
import { normalizeHeadConfig, randomHeadConfig } from './head-config.js';
import { AUDIO_TIERS } from './perf/lod.js';

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

function resolveHead(head, seed) {
  if (head === 'random') {
    return randomHeadConfig(seed ?? Date.now());
  }
  return normalizeHeadConfig(head);
}

/**
 * Prepare everything needed to render: IPA, plan and renderer options.
 * @param {string} text Text (or IPA when `options.ipa` is true).
 * @param {object} [options]
 */
export function prepareUtterance(text, options = {}) {
  const head = resolveHead(options.head, options.seed);
  const transcription = options.ipa
    ? { lang: options.lang ?? 'ipa', ipa: String(text), words: [] }
    : textToIpa(text, { lang: options.lang });
  const plan = planUtterance(transcription.ipa, {
    head,
    language: transcription.lang,
  });
  const tier = getAudioTier(options.tier) ?? {};
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
  };
  return { ...transcription, head, plan, renderOptions };
}

/**
 * Synthesize speech from text. `microphone`, `room` and `enclosure` choose
 * where and in what space the voice is heard (see VoiceRenderer).
 * @param {string} text
 * @param {{lang?: string, ipa?: boolean, head?: object|'random', seed?: string|number, tier?: string|number, solver?: string, sections?: number, dx?: number, sampleRate?: number, output?: 'flow'|'microphone', microphone?: {distance?: number, azimuth?: number, elevation?: number, compensate?: boolean}, room?: string|object, enclosure?: {width: number, height: number, depth: number, absorption?: number, center?: number[]}}} [options]
 * @returns {{lang: string, ipa: string, words: object[], head: object, plan: object, sampleRate: number, samples: Float32Array, duration: number}}
 */
export function synthesize(text, options = {}) {
  const prepared = prepareUtterance(text, options);
  const samples = renderPlan(prepared.plan, prepared.renderOptions);
  const { sampleRate } = prepared.renderOptions;
  return {
    lang: prepared.lang,
    ipa: prepared.ipa,
    words: prepared.words,
    head: prepared.head,
    plan: prepared.plan,
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
    const written = renderer.render(chunk);
    if (written === 0) {
      break;
    }
    yield chunk.subarray(0, written);
    // Let the event loop deliver the chunk before simulating the next one.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
}
