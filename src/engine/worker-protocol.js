/**
 * The synthesis worker of the library (`voice-simulator/worker`, see
 * ./worker.js): runs the acoustic simulation off the main thread and
 * streams audio chunks, each with the RMS pressure field of that chunk so
 * a 3D view can show the waves that produced the sound. It renders with
 * the engine of createEngine (./index.js): Rust by default, JavaScript
 * where Rust cannot load or render.
 *
 * Messages in:
 *   {type: 'engine', engine?, threads?, simd?}  -> {type: 'engine', name,
 *     simd, threads, reason}: the engine those options give (createEngine)
 *   {type: 'benchmark', head, gpu?, engine?, threads?, simd?}
 *     -> {type: 'benchmark', ...result of benchmarkDevice, gpu, gpuLoads,
 *     gpuPending}: the silent device benchmark (issue 28,
 *     src/perf/device-benchmark.js). It pauses every 20 ms of work and
 *     stops while an utterance is waiting or being rendered; the rest is
 *     measured 500 ms after the last utterance ended. With `gpuPending`
 *     a second `benchmark` message follows: the 3D tiers above the CPU's
 *     choice measured on WebGPU (unless `gpu: false`; at most 2 s, waiting
 *     like the CPU stage while utterances are rendered), with `gpu`
 *     telling whether the chosen tier runs there
 *   {type: 'speak', id, ipa, lang, head, seed, tier, auto, chunkSize,
 *    microphone?, room?, enclosure?, gpu?, engine?, threads?, simd?}
 *   (`gpu: false` keeps the 3D tiers on the CPU; otherwise they run on
 *   WebGPU where the browser has it, and on the CPU where it does not)
 *   {type: 'cancel', id}
 * Messages out (per utterance):
 *   {type: 'start', id, sampleRate, solver, gpu, totalSamples, model?,
 *     engine, fallbackReason}  (`engine`: 'rust' or 'js', the engine that
 *     renders this utterance; `fallbackReason`: why it is not Rust, or null)
 *   {type: 'overload', id, from, level, load}  (auto mode: the tier could
 *     not keep up, the utterance restarts on the cheaper `level`)
 *   {type: 'chunk', id, start, samples, field, load}
 *   {type: 'end', id, load}
 *   {type: 'error', id, message}
 */

import { releaseRenderer } from '../acoustics/voice.js';
import {
  buildVoxelModel,
  voxelModelOptions,
} from '../acoustics/voxel-model.js';
import { requestGpuDevice } from '../acoustics/fdtd-gpu.js';
import { encodeHeadConfig } from '../head-config.js';
import { benchmarkRenderer, measureAudioTierAsync } from '../perf/benchmark.js';
import { benchmarkDevice } from '../perf/device-benchmark.js';
import {
  AUDIO_TIERS,
  BASE_AUDIO_LEVEL,
  OverloadDetector,
  chooseGpuTier,
  fallbackLevel,
} from '../perf/lod.js';
import { prepareUtterance } from '../synthesize.js';
import { createEngine } from './index.js';

/** Seconds of audio per tier of the WebGPU benchmark. */
const BENCHMARK_SECONDS = 0.08;
/** Wall-clock limit of the WebGPU benchmark in ms. */
const GPU_BENCHMARK_LIMIT = 2000;
/** Wait in ms after an utterance before a stopped benchmark continues. */
const BENCHMARK_RESUME_DELAY = 500;
/** Samples between field measurements. */
const FIELD_BLOCK = 128;

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

  /** @param {{field?: () => {pressure: ArrayLike<number>, nose?: ArrayLike<number>}}} source */
  add(source) {
    const field = source.field?.();
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

/**
 * Where the field of a renderer comes from: the Rust renderer itself, or
 * the solver of the JavaScript renderer.
 */
function fieldSource(renderer) {
  return renderer.engine === 'rust' ? renderer : renderer.solver;
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
    meter.add(fieldSource(renderer));
  }
  return written;
}

/** Positions and kinds of the cells of the voxel model (3D tiers). */
function modelPayload(model) {
  if (!model) {
    return null;
  }
  return {
    positions: Float32Array.from(model.cells.flatMap((cell) => cell.point)),
    kinds: Uint8Array.from(model.cells, (cell) => cell.kind),
  };
}

/** The options of createEngine in a message. */
function engineOptions(message) {
  return {
    engine: message.engine,
    threads: message.threads,
    simd: message.simd,
  };
}

/** The WebGPU device of the handler, requested once; null without WebGPU. */
function gpu(state) {
  state.gpuDevice ??= Promise.resolve()
    .then(() => state.requestDevice())
    .catch(() => null);
  return state.gpuDevice;
}

/** Voxel model for a head, cell size and listening settings (cached). */
function voxelModel(state, head, settings) {
  const { models } = state;
  const modelOptions = voxelModelOptions(settings);
  const key = `${JSON.stringify(modelOptions)}|${encodeHeadConfig(head)}`;
  if (!models.has(key)) {
    if (models.size > 4) {
      models.clear();
    }
    models.set(key, buildVoxelModel(head, modelOptions));
  }
  return models.get(key);
}

async function speak(state, message) {
  const tier = AUDIO_TIERS[message.tier];
  const device =
    tier.solver === 'fdtd3d' && message.gpu !== false ? await gpu(state) : null;
  const progress = { busy: 0, chunks: 0 };
  let outcome;
  try {
    outcome = await run(state, message, device, progress);
  } catch (error) {
    if (!device) {
      throw error;
    }
    // A lost or failing GPU: start the utterance again on the CPU.
    console.warn('WebGPU synthesis failed, using the CPU', error);
    state.gpuDevice = Promise.resolve(null);
    if (progress.chunks > 0) {
      state.post({
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
    await speak(state, { ...message, tier: outcome });
  }
}

/** Set up the renderer and stream the utterance (see stream). */
async function run(state, message, device, progress) {
  const { id } = message;
  const tier = AUDIO_TIERS[message.tier];
  const engine = await createEngine(engineOptions(message));
  const model =
    tier.solver === 'fdtd3d'
      ? voxelModel(state, message.head, {
          dx: tier.dx,
          microphone: message.microphone,
          enclosure: message.enclosure,
        })
      : undefined;
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
    model,
  });
  const renderer = engine.createRenderer(prepared.plan, prepared.renderOptions);
  try {
    state.post({
      type: 'start',
      id,
      sampleRate: renderer.sampleRate,
      solver: tier.solver,
      gpu: Boolean(device),
      totalSamples: renderer.totalSamples,
      model: modelPayload(model),
      engine: renderer.engine,
      fallbackReason: renderer.fallbackReason,
    });
    const outcome = await stream(state, message, renderer, progress);
    if (outcome === 'done') {
      state.post({
        type: 'end',
        id,
        load: progress.busy / prepared.plan.duration,
      });
    }
    return outcome;
  } finally {
    releaseRenderer(renderer);
  }
}

/** The chunk message of `samples` and the buffers it transfers. */
function chunkMessage(id, start, samples, written, field, load) {
  const transfer = [samples.buffer];
  if (field) {
    transfer.push(field.pressure.buffer);
    if (field.nose) {
      transfer.push(field.nose.buffer);
    }
  }
  const message = {
    type: 'chunk',
    id,
    start,
    samples: samples.subarray(0, written),
    field,
    load,
  };
  return [message, transfer];
}

/**
 * Render and post the chunks of an utterance.
 * @returns {Promise<'done'|'cancelled'|number>} the cheaper tier to
 *   restart on when this one could not keep up
 */
async function stream(state, message, renderer, progress) {
  const { id } = message;
  const chunkSize = message.chunkSize ?? 1024;
  const meter = new FieldMeter();
  const detector = new OverloadDetector();
  while (!renderer.done) {
    if (state.current !== id) {
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
      // Detected within the first chunks, while the audio is still in
      // the player's lead: restart on a tier predicted to keep up.
      const level = fallbackLevel(AUDIO_TIERS, message.tier, detector.load);
      state.post({
        type: 'overload',
        id,
        from: message.tier,
        level,
        load: detector.load,
      });
      return level;
    }
    const load = busy / (written / renderer.sampleRate);
    state.post(
      ...chunkMessage(id, start, samples, written, meter.take(), load)
    );
    progress.chunks++;
    await yieldToMessages();
  }
  return 'done';
}

/**
 * Start the device benchmark of a `benchmark` message (see
 * runBenchmark).
 */
async function benchmark(state, message) {
  state.benchmarkRuns++;
  state.benchmark = {
    message,
    partial: null,
    running: false,
    run: state.benchmarkRuns,
  };
  await runBenchmark(state);
}

/**
 * Resolves BENCHMARK_RESUME_DELAY ms after the last utterance ends (see
 * speakNow), or immediately when no utterance is being rendered.
 */
function quiet(state) {
  if (state.speaking === 0 && state.resumeTimer === undefined) {
    return Promise.resolve();
  }
  return new Promise((resolve) => state.quietWaiters.push(resolve));
}

/**
 * Run or continue the pending benchmark: benchmarkDevice with `paused`
 * true while an utterance is being rendered. A partial result is kept and
 * continued BENCHMARK_RESUME_DELAY ms after the utterance (see speakNow);
 * a complete one is posted, then the WebGPU tiers are measured. A newer
 * `benchmark` message replaces the run: the old one stops at its next
 * pause and posts nothing.
 */
async function runBenchmark(state) {
  const job = state.benchmark;
  if (!job || job.running || state.speaking > 0) {
    return;
  }
  job.running = true;
  const { message } = job;
  let result;
  try {
    result = await benchmarkDevice({
      engine: await createEngine(engineOptions(message)),
      head: message.head,
      resume: job.partial,
      paused: () => state.speaking > 0 || state.benchmark !== job,
      measure: (tier, info) =>
        benchmarkRenderer(tier, {
          ...info,
          model:
            tier.solver === 'fdtd3d'
              ? voxelModel(state, message.head, { dx: tier.dx })
              : undefined,
        }),
    });
  } finally {
    job.running = false;
  }
  if (state.benchmark !== job) {
    return;
  }
  if (result.partial) {
    job.partial = result;
    return;
  }
  state.benchmark = null;
  const gpuPending =
    message.gpu !== false &&
    AUDIO_TIERS.some(
      (tier, index) => index > result.level && tier.solver === 'fdtd3d'
    );
  const cpu = {
    type: 'benchmark',
    ...result,
    gpu: false,
    gpuLoads: AUDIO_TIERS.map(() => null),
  };
  state.post({ ...cpu, gpuPending });
  if (gpuPending) {
    const gpuResult = await benchmarkGpu(state, job, result).catch((error) => {
      console.warn('WebGPU benchmark failed', error);
      state.gpuDevice = Promise.resolve(null);
      return null;
    });
    if (state.benchmarkRuns !== job.run) {
      // A newer `benchmark` message answers instead.
      return;
    }
    state.post({
      ...cpu,
      ...(gpuResult && {
        level: gpuResult.level,
        tier: AUDIO_TIERS[gpuResult.level],
        gpu: gpuResult.gpu,
        gpuLoads: gpuResult.gpuLoads,
      }),
      gpuPending: false,
    });
  }
}

/**
 * The 3D tiers above the CPU's choice on WebGPU (chooseGpuTier), for at
 * most GPU_BENCHMARK_LIMIT ms: a tier that would start later counts as too
 * slow. Like the CPU stage it never runs beside an utterance: it waits for
 * a quiet moment (quiet) before the device and before each tier, and the
 * wait does not count for the limit. Null without WebGPU.
 */
async function benchmarkGpu(state, job, cpu) {
  const { message } = job;
  await quiet(state);
  const device = await gpu(state);
  if (!device) {
    return null;
  }
  const engine = await createEngine(engineOptions(message));
  let deadline = globalThis.performance.now() + GPU_BENCHMARK_LIMIT;
  const measure = async (tier, { limit }) => {
    const from = globalThis.performance.now();
    await quiet(state);
    deadline += globalThis.performance.now() - from;
    if (
      state.benchmarkRuns !== job.run ||
      globalThis.performance.now() > deadline
    ) {
      return Infinity;
    }
    return measureAudioTierAsync(tier, {
      head: message.head,
      seconds: BENCHMARK_SECONDS,
      limit,
      device,
      engine,
    });
  };
  return chooseGpuTier(measure, cpu, { tiers: AUDIO_TIERS, gpu: true });
}

/** Post the fallback answer of a failed benchmark. */
function benchmarkFailed(state, error) {
  // Stay on the cheapest full-band tier.
  console.warn('Benchmark failed', error);
  state.benchmark = null;
  state.post({ type: 'benchmark', level: BASE_AUDIO_LEVEL, loads: [] });
}

/**
 * Speak, with the benchmark stopped meanwhile and continued
 * BENCHMARK_RESUME_DELAY ms after the last utterance.
 */
async function speakNow(state, message) {
  state.speaking++;
  globalThis.clearTimeout(state.resumeTimer);
  state.resumeTimer = undefined;
  try {
    await speak(state, message);
  } finally {
    state.speaking--;
    if (
      state.speaking === 0 &&
      (state.benchmark || state.quietWaiters.length > 0)
    ) {
      state.resumeTimer = globalThis.setTimeout(() => {
        state.resumeTimer = undefined;
        for (const resolve of state.quietWaiters.splice(0)) {
          resolve();
        }
        runBenchmark(state).catch((error) => benchmarkFailed(state, error));
      }, BENCHMARK_RESUME_DELAY);
    }
  }
}

async function describeEngine(state, message) {
  const engine = await createEngine(engineOptions(message));
  state.post({
    type: 'engine',
    name: engine.name,
    simd: engine.simd,
    threads: engine.threads,
    reason: engine.reason,
  });
}

/**
 * The message handler of the synthesis worker.
 * @param {(message: object, transfer?: Transferable[]) => void} post
 *   posts a message out (`self.postMessage` in a worker)
 * @param {{requestGpuDevice?: () => Promise<object|null>}} [options]
 *   `requestGpuDevice` gives the WebGPU device (default: requestGpuDevice
 *   of src/acoustics/fdtd-gpu.js)
 * @returns {(message: object) => Promise<void>} handles one message in;
 *   the promise settles when the message is answered (errors are posted)
 */
export function createWorkerHandler(post, options = {}) {
  const state = {
    post,
    requestDevice: options.requestGpuDevice ?? requestGpuDevice,
    models: new Map(),
    /** The id of the utterance being spoken; 0 after a cancel. */
    current: 0,
    gpuDevice: undefined,
    /** Utterances being rendered: the benchmark stops while above 0. */
    speaking: 0,
    /** The benchmark asked for and not finished: {message, partial}. */
    benchmark: null,
    /** `benchmark` messages so far: a newer one stops an older one. */
    benchmarkRuns: 0,
    /** Set from the end of the last utterance until the benchmark goes on. */
    resumeTimer: undefined,
    /** Resolvers of quiet(), called when resumeTimer fires. */
    quietWaiters: [],
  };
  return async function handle(message) {
    if (message.type === 'cancel') {
      state.current = 0;
      return;
    }
    if (message.type === 'engine') {
      await describeEngine(state, message).catch((error) => {
        post({ type: 'engine', name: null, error: error.message });
      });
      return;
    }
    if (message.type === 'benchmark') {
      await benchmark(state, message).catch((error) =>
        benchmarkFailed(state, error)
      );
      return;
    }
    if (message.type === 'speak') {
      state.current = message.id;
      await speakNow(state, message).catch((error) => {
        post({ type: 'error', id: message.id, message: error.message });
      });
    }
  };
}
