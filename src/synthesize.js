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
import { parseIpa } from './ipa/parse.js';
import { normalizeHeadConfig, randomHeadConfig } from './head-config.js';
import { accentSettings } from './accent/index.js';
import { offsetHead } from './accent/head.js';
import { AUDIO_TIERS, DEFAULT_AUDIO_TIER } from './perf/lod.js';
import {
  EFFORT_RAMP_LIMIT,
  fastEffortRamps,
  maxModeLevel,
} from './articulation/effort.js';
import { normalizeLoudness } from './analysis/loudness.js';

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
 * The prosody and articulation of the accent of a transcription (null for
 * IPA input of no known language). The accent option of IPA input only
 * changes the head and the timing: its words are not rewritten.
 */
function transcriptionAccent(transcription, options) {
  const settings = accentSettings(
    transcription.lang,
    options.accent ?? transcription.accent ?? undefined,
    { level: options.accentLevel, lenient: options.ipa !== true }
  );
  return settings
    ? {
        code: settings.code,
        level: settings.level,
        prosody: settings.prosody,
        articulation: settings.articulation,
      }
    : null;
}

/** The transcription of a text (or IPA) and its accent. */
function transcribe(text, options) {
  const transcription = options.ipa
    ? {
        lang: options.lang ?? 'ipa',
        ipa: String(text),
        words: [],
        modes: parseIpa(String(text)).modes,
        warnings: [],
      }
    : textToIpa(text, {
        lang: options.lang,
        accent: options.accent,
        accentLevel: options.accentLevel,
        weakForms: options.weakForms,
        lexicon: options.lexicon,
        markup: options.markup,
      });
  const accent = transcriptionAccent(transcription, options);
  if (accent && options.ipa) {
    Object.assign(transcription, {
      accent: accent.code,
      accentLevel: accent.level,
    });
  }
  return { transcription, accent };
}

/**
 * The level offset (dB) of the output: minus the loudest level of the mode
 * spans (`E + gain`, at least 0), or minus `headroom` when one is given, so
 * that loud modes do not clip and plain speech keeps its samples.
 */
function levelOffset(plan, headroom) {
  const level =
    headroom === undefined || headroom === null
      ? maxModeLevel(plan.modes)
      : Number(headroom);
  if (!Number.isFinite(level)) {
    throw new RangeError(`headroom must be a number of dB: ${headroom}`);
  }
  return level === 0 ? 0 : -level;
}

/** Warnings for effort ramps faster than EFFORT_RAMP_LIMIT dB/s. */
function rampWarnings(plan, timeline) {
  return fastEffortRamps(plan.modes).map((ramp) => {
    const word = timeline.words.find((item) => item.end > ramp.start);
    return {
      position: word?.sourceStart ?? 0,
      message:
        `effort changes by ${ramp.rate.toFixed(0)} dB/s, faster than ` +
        `${EFFORT_RAMP_LIMIT} dB/s`,
    };
  });
}

/**
 * The audio tier of the options: without a tier or a solver the default
 * (3D) tier applies; a solver alone keeps its own defaults.
 */
function resolveTier(options) {
  return (
    getAudioTier(
      options.tier ?? (options.solver ? undefined : DEFAULT_AUDIO_TIER)
    ) ?? {}
  );
}

/**
 * Prepare everything needed to render: IPA, plan and renderer options.
 * @param {string} text Text (or IPA when `options.ipa` is true).
 * @param {object} [options] `accent` and `accentLevel` as in textToIpa;
 *   the accent's articulation offsets are added to the head.
 */
export function prepareUtterance(text, options = {}) {
  const baseHead = resolveHead(options.head, options.seed, options.preset);
  const { transcription, accent } = transcribe(text, options);
  const head = offsetHead(baseHead, accent?.articulation);
  const plan = planUtterance(transcription.ipa, {
    head: baseHead,
    language: transcription.lang,
    accent: accent ?? undefined,
    modes: transcription.modes,
  });
  const timeline = utteranceTimeline(plan, {
    words: transcription.words,
    ipa: transcription.ipa,
    language: transcription.lang,
  });
  const tier = resolveTier(options);
  const renderOptions = {
    solver: options.solver ?? tier.solver,
    source: options.source,
    interaction: options.interaction,
    subglottal: options.subglottal,
    sections: options.sections ?? tier.sections,
    dx: options.dx ?? tier.dx,
    sampleRate: options.sampleRate ?? tier.sampleRate ?? 48000,
    blockSize: options.blockSize ?? tier.blockSize,
    bandLimit: options.bandLimit ?? tier.bandLimit,
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
    levelOffsetDb: levelOffset(plan, options.headroom),
  };
  const warnings = [
    ...(transcription.warnings ?? []),
    ...rampWarnings(plan, timeline),
  ];
  return { ...transcription, warnings, head, plan, timeline, renderOptions };
}

/**
 * Synthesize speech from text. `microphone`, `room` and `enclosure` choose
 * where and in what space the voice is heard (see VoiceRenderer). `source`
 * picks the voice source: 'lf' (default) or 'folds' (physical vocal folds);
 * `interaction` couples the folds to the vocal tract and the trachea
 * (source-tract interaction, folds only). `markup` reads speech markup
 * (docs/markup.md): a text that starts with `<speak` is SSML unless
 * `markup` is false, and `true` also reads inline tags; the result has the
 * mode spans (`modes`, IPA word indexes; `plan.modes` in seconds) and the
 * markup `warnings`. Malformed SSML throws `MarkupError`.
 *
 * Loud speech modes (issue 52) raise the level of the voice by their effort
 * and gain; the output is lowered by the loudest of them, `levelOffsetDb`
 * of the result (0 for plain speech), so that a shout does not clip.
 * `headroom` (dB) sets that offset to `-headroom` instead: with the same
 * headroom, renderings of different modes have comparable levels.
 * `loudnessTarget` (LUFS, ITU-R BS.1770) scales the result to that
 * integrated loudness, with the peak at most 0.98.
 * @param {string} text
 * @param {{lang?: string, accent?: string|object, accentLevel?: number, ipa?: boolean, markup?: boolean, headroom?: number, loudnessTarget?: number, head?: object|'random', seed?: string|number, preset?: string, tier?: string|number, solver?: string, source?: 'lf'|'folds', interaction?: boolean, subglottal?: boolean, sections?: number, dx?: number, sampleRate?: number, blockSize?: number, bandLimit?: number, output?: 'flow'|'microphone', microphone?: {distance?: number, azimuth?: number, elevation?: number, compensate?: boolean}, room?: string|object, enclosure?: {width: number, height: number, depth: number, absorption?: number, center?: number[]}, teeth?: boolean, piriform?: boolean, vallecula?: boolean}} [options]
 * @returns {{lang: string, accent: string|null, accentLevel: number|null, ipa: string, words: object[], modes: {from: number, to: number, mode: object}[], warnings: {position: number, message: string}[], head: object, plan: object, timeline: object, sampleRate: number, samples: Float32Array, duration: number, levelOffsetDb: number, loudness?: number}}
 */
export function synthesize(text, options = {}) {
  const prepared = prepareUtterance(text, options);
  return result(
    prepared,
    renderPlan(prepared.plan, prepared.renderOptions),
    options
  );
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
  return result(prepared, samples, options);
}

function result(prepared, rendered, options) {
  const { sampleRate, levelOffsetDb } = prepared.renderOptions;
  let samples = rendered;
  let offset = levelOffsetDb;
  let loudness;
  if (options.loudnessTarget !== undefined && options.loudnessTarget !== null) {
    const normalized = normalizeLoudness(
      rendered,
      sampleRate,
      Number(options.loudnessTarget)
    );
    samples = normalized.samples;
    offset += normalized.gainDb;
    loudness = normalized.loudness;
  }
  return {
    lang: prepared.lang,
    accent: prepared.accent ?? null,
    accentLevel: prepared.accentLevel ?? null,
    ipa: prepared.ipa,
    words: prepared.words,
    modes: prepared.modes,
    warnings: prepared.warnings,
    head: prepared.head,
    plan: prepared.plan,
    timeline: prepared.timeline,
    sampleRate,
    samples,
    duration: samples.length / sampleRate,
    levelOffsetDb: offset,
    ...(loudness === undefined ? {} : { loudness }),
  };
}

/**
 * Synthesize speech incrementally. Chunks are produced as they are
 * simulated, so playback or network streaming can start immediately.
 * `loudnessTarget` needs the whole signal and throws here; the headroom of
 * loud modes applies as in synthesize().
 * @param {string} text
 * @param {Parameters<typeof synthesize>[1] & {chunkSize?: number}} [options]
 * @returns {AsyncGenerator<Float32Array>}
 */
export async function* synthesizeStream(text, options = {}) {
  if (options.loudnessTarget !== undefined && options.loudnessTarget !== null) {
    throw new Error(
      'loudnessTarget needs the whole signal: use synthesize() or synthesizeAsync()'
    );
  }
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
