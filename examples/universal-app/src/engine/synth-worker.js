/**
 * Synthesis worker: runs the acoustic simulation off the main thread and
 * streams audio chunks, each with the RMS pressure field of that chunk so the
 * 3D view can show the waves that produced the sound.
 *
 * Messages in:
 *   {type: 'benchmark', head}                 -> {type: 'benchmark', level, loads}
 *   {type: 'speak', id, ipa, lang, head, seed, tier, auto, chunkSize,
 *    microphone?, room?, enclosure?, gpu?}
 *   (`gpu: false` keeps the 3D tiers on the CPU; otherwise they run on
 *   WebGPU where the browser has it, and on the CPU where it does not)
 *   {type: 'cancel', id}
 * Messages out (per utterance):
 *   {type: 'start', id, sampleRate, solver, gpu, totalSamples, model?}
 *   {type: 'overload', id, from, level, load}  (auto mode: the tier could
 *     not keep up, the utterance restarts on the cheaper `level`)
 *   {type: 'chunk', id, start, samples, field, load}
 *   {type: 'end', id, load}
 *   {type: 'error', id, message}
 */

import {
  AUDIO_TIERS,
  OverloadDetector,
  VoiceRenderer,
  buildVoxelModel,
  chooseTier,
  encodeHeadConfig,
  fallbackLevel,
  measureAudioTier,
  prepareUtterance,
  requestGpuDevice,
  voxelModelOptions,
} from '../../../../src/index.js';

const BENCHMARK_SECONDS = 0.08;
/** Samples between field measurements. */
const FIELD_BLOCK = 128;
const models = new Map();
let current = 0;
/** The WebGPU device, requested once; null without WebGPU or after a failure. */
let gpuDevice;

function gpu() {
  gpuDevice ??= requestGpuDevice().catch(() => null);
  return gpuDevice;
}

/** Voxel model for a head, cell size and listening settings (cached). */
function voxelModel(head, settings) {
  const options = voxelModelOptions(settings);
  const key = `${JSON.stringify(options)}|${encodeHeadConfig(head)}`;
  if (!models.has(key)) {
    if (models.size > 4) {
      models.clear();
    }
    models.set(key, buildVoxelModel(head, options));
  }
  return models.get(key);
}

function yieldToMessages() {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

/** Accumulates the mean square pressure per cell over a chunk. */
class FieldMeter {
  constructor() {
    this.sums = null;
    this.noseSums = null;
    this.count = 0;
  }

  add(solver) {
    const field = solver.field?.();
    if (!field) {
      return;
    }
    this.sums ??= new Float64Array(field.pressure.length);
    accumulate(this.sums, field.pressure);
    if (field.nose) {
      this.noseSums ??= new Float64Array(field.nose.length);
      accumulate(this.noseSums, field.nose);
    }
    this.count++;
  }

  /** RMS pressure per cell since the last call. */
  take() {
    if (!this.sums || this.count === 0) {
      return null;
    }
    const rms = (sums) =>
      sums
        ? Float32Array.from(sums, (sum) => Math.sqrt(sum / this.count))
        : null;
    const result = { pressure: rms(this.sums), nose: rms(this.noseSums) };
    this.sums.fill(0);
    this.noseSums?.fill(0);
    this.count = 0;
    return result;
  }
}

function accumulate(sums, values) {
  for (let index = 0; index < values.length; index++) {
    sums[index] += values[index] * values[index];
  }
}

async function renderChunk(renderer, samples, meter) {
  if (renderer.solver.gpu) {
    // One dispatch for the whole chunk; the field is its RMS pressure.
    const written = await renderer.renderAsync(samples, { field: true });
    meter.add(renderer.solver);
    return written;
  }
  let written = 0;
  while (written < samples.length && !renderer.done) {
    const end = Math.min(samples.length, written + FIELD_BLOCK);
    const count = renderer.render(samples.subarray(written, end));
    if (count === 0) {
      break;
    }
    written += count;
    meter.add(renderer.solver);
  }
  return written;
}

function modelPayload(solver) {
  if (!solver.model) {
    return null;
  }
  const field = solver.field();
  return {
    positions: Float32Array.from(field.positions),
    kinds: Uint8Array.from(field.kinds),
  };
}

async function speak(message) {
  const tier = AUDIO_TIERS[message.tier];
  const device =
    tier.solver === 'fdtd3d' && message.gpu !== false ? await gpu() : null;
  const progress = { busy: 0, chunks: 0 };
  let outcome;
  try {
    outcome = await run(message, device, progress);
  } catch (error) {
    if (!device) {
      throw error;
    }
    // A lost or failing GPU: start the utterance again on the CPU.
    console.warn('WebGPU synthesis failed, using the CPU', error);
    gpuDevice = Promise.resolve(null);
    if (progress.chunks > 0) {
      globalThis.postMessage({
        type: 'overload',
        id: message.id,
        from: message.tier,
        level: message.tier,
        load: 0,
      });
    }
    outcome = message.tier;
  }
  if (typeof outcome === 'number') {
    await speak({ ...message, tier: outcome });
  }
}

/** Set up the renderer and stream the utterance (see stream). */
async function run(message, device, progress) {
  const { id } = message;
  const tier = AUDIO_TIERS[message.tier];
  const prepared = prepareUtterance(message.ipa, {
    ipa: true,
    lang: message.lang,
    head: message.head,
    seed: message.seed,
    tier: message.tier,
    microphone: message.microphone,
    room: message.room,
    enclosure: message.enclosure,
    device: device ?? undefined,
    model:
      tier.solver === 'fdtd3d'
        ? voxelModel(message.head, {
            dx: tier.dx,
            microphone: message.microphone,
            enclosure: message.enclosure,
          })
        : undefined,
  });
  const renderer = new VoiceRenderer(prepared.plan, prepared.renderOptions);
  try {
    globalThis.postMessage({
      type: 'start',
      id,
      sampleRate: renderer.sampleRate,
      solver: tier.solver,
      gpu: Boolean(device),
      totalSamples: renderer.totalSamples,
      model: modelPayload(renderer.solver),
    });
    const outcome = await stream(message, renderer, progress);
    if (outcome === 'done') {
      globalThis.postMessage({
        type: 'end',
        id,
        load: progress.busy / prepared.plan.duration,
      });
    }
    return outcome;
  } finally {
    renderer.solver.gpu?.destroy();
  }
}

/**
 * Render and post the chunks of an utterance.
 * @returns {Promise<'done'|'cancelled'|number>} the cheaper tier to restart
 *   on when this one could not keep up
 */
async function stream(message, renderer, progress) {
  const { id } = message;
  const chunkSize = message.chunkSize ?? 1024;
  const meter = new FieldMeter();
  const detector = new OverloadDetector();
  while (!renderer.done) {
    if (current !== id) {
      return 'cancelled';
    }
    const start = renderer.position;
    const samples = new Float32Array(chunkSize);
    const began = globalThis.performance.now();
    const written = await renderChunk(renderer, samples, meter);
    const busy = (globalThis.performance.now() - began) / 1000;
    progress.busy += busy;
    const overloaded = detector.record(busy, written / renderer.sampleRate);
    if (overloaded && message.auto && message.tier > 0) {
      // Detected within the first chunks, while the audio is still in the
      // player's lead: restart on a tier that is predicted to keep up.
      const level = fallbackLevel(AUDIO_TIERS, message.tier, detector.load);
      globalThis.postMessage({
        type: 'overload',
        id,
        from: message.tier,
        level,
        load: detector.load,
      });
      return level;
    }
    const field = meter.take();
    const transfer = [samples.buffer];
    if (field) {
      transfer.push(field.pressure.buffer);
      if (field.nose) {
        transfer.push(field.nose.buffer);
      }
    }
    globalThis.postMessage(
      {
        type: 'chunk',
        id,
        start,
        samples: samples.subarray(0, written),
        field,
        load: busy / (written / renderer.sampleRate),
      },
      transfer
    );
    progress.chunks++;
    await yieldToMessages();
  }
  return 'done';
}

function benchmark(message) {
  const result = chooseTier(
    (tier, { limit }) =>
      measureAudioTier(tier, {
        head: message.head,
        seconds: BENCHMARK_SECONDS,
        limit,
      }),
    { tiers: AUDIO_TIERS, target: 0.8 }
  );
  globalThis.postMessage({ type: 'benchmark', ...result });
}

globalThis.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'cancel') {
    current = 0;
    return;
  }
  if (message.type === 'benchmark') {
    benchmark(message);
    return;
  }
  if (message.type === 'speak') {
    current = message.id;
    speak(message).catch((error) => {
      globalThis.postMessage({
        type: 'error',
        id: message.id,
        message: error.message,
      });
    });
  }
});
