/**
 * Synthesis worker: runs the acoustic simulation off the main thread and
 * streams audio chunks, each with the RMS pressure field of that chunk so the
 * 3D view can show the waves that produced the sound.
 *
 * Messages in:
 *   {type: 'benchmark', head}                 -> {type: 'benchmark', level, loads}
 *   {type: 'speak', id, ipa, lang, head, seed, tier, chunkSize}
 *   {type: 'cancel', id}
 * Messages out (per utterance):
 *   {type: 'start', id, sampleRate, solver, totalSamples, model?}
 *   {type: 'chunk', id, start, samples, field, load}
 *   {type: 'end', id, load}
 *   {type: 'error', id, message}
 */

import {
  AUDIO_TIERS,
  VoiceRenderer,
  buildVoxelModel,
  chooseTier,
  encodeHeadConfig,
  measureAudioTier,
  prepareUtterance,
} from '../../../../src/index.js';

const BENCHMARK_SECONDS = 0.08;
/** Samples between field measurements. */
const FIELD_BLOCK = 128;
const models = new Map();
let current = 0;

function voxelModel(head, dx) {
  const key = `${dx}|${encodeHeadConfig(head)}`;
  if (!models.has(key)) {
    if (models.size > 4) {
      models.clear();
    }
    models.set(key, buildVoxelModel(head, { dx }));
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

function renderChunk(renderer, samples, meter) {
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
  const { id } = message;
  const tier = AUDIO_TIERS[message.tier];
  const prepared = prepareUtterance(message.ipa, {
    ipa: true,
    lang: message.lang,
    head: message.head,
    seed: message.seed,
    tier: message.tier,
    model:
      tier.solver === 'fdtd3d' ? voxelModel(message.head, tier.dx) : undefined,
  });
  const renderer = new VoiceRenderer(prepared.plan, prepared.renderOptions);
  globalThis.postMessage({
    type: 'start',
    id,
    sampleRate: renderer.sampleRate,
    solver: tier.solver,
    totalSamples: renderer.totalSamples,
    model: modelPayload(renderer.solver),
  });
  const chunkSize = message.chunkSize ?? 1024;
  const meter = new FieldMeter();
  let busyTotal = 0;
  while (!renderer.done) {
    if (current !== id) {
      return;
    }
    const start = renderer.position;
    const samples = new Float32Array(chunkSize);
    const began = globalThis.performance.now();
    const written = renderChunk(renderer, samples, meter);
    const busy = (globalThis.performance.now() - began) / 1000;
    busyTotal += busy;
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
    await yieldToMessages();
  }
  globalThis.postMessage({
    type: 'end',
    id,
    load: busyTotal / prepared.plan.duration,
  });
}

function benchmark(message) {
  const result = chooseTier(
    (tier) =>
      measureAudioTier(tier, {
        head: message.head,
        seconds: BENCHMARK_SECONDS,
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
