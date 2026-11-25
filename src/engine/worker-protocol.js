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
 *    streamRate?, maxTier?, microphone?, room?, enclosure?, gpu?, engine?,
 *    threads?, simd?, breaths?, source?, interaction?, subglottal?,
 *    headroom?}
 *   (`breaths`, `source`, `interaction`, `subglottal` and `headroom` as in
 *   synthesize(); interaction is left off on WebGPU, which cannot couple
 *   the folds to the tract)
 *   (`gpu: false` keeps the 3D tiers on the CPU; otherwise they run on
 *   WebGPU where the browser has it, and on the CPU where it does not)
 *   {type: 'underrun', id}  (the player ran dry: in automatic mode the
 *     tier steps down without waiting)
 *   {type: 'cancel', id}
 * Messages out (per utterance):
 *   {type: 'start', id, sampleRate, solver, gpu, totalSamples, model?,
 *     engine, fallbackReason}  (`engine`: 'rust' or 'js', the engine that
 *     renders this utterance; `fallbackReason`: why it is not Rust, or null)
 *   {type: 'tier', id, at, from, level, reason, gainDb, solver, gpu, model}
 *     (automatic mode: from `at` seconds on the utterance is heard at tier
 *     `level`; `reason` is 'load', 'headroom' or 'underrun')
 *   {type: 'overload', id, from, level, load}  (WebGPU failed: the
 *     utterance restarts on the CPU)
 *   {type: 'chunk', id, start, samples, field, load}
 *   {type: 'end', id, load, level}
 *   {type: 'error', id, message}
 *
 * With `auto: true` the utterance streams at `streamRate` (default 48000
 * Hz; `start.sampleRate` is that rate) through an AdaptiveStream
 * (./adaptive-stream.js) and a StreamGovernor (../perf/lod.js) changes its
 * tier between chunks: down when the render load is above 0.8 or the
 * player ran dry, up one level after 3 s of headroom, up to `maxTier`.
 * Without `maxTier` it climbs within the solver of `tier`: up to the last
 * waveguide tier from a waveguide tier and not at all from a 3D tier
 * (each 3D tier needs its own voxel model, and building one stalls the
 * stream for 0.3 to 0.5 s: experiments/issue-29-voxel-time.mjs). With
 * `auto: false` the utterance streams at the rate of its tier.
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
  StreamGovernor,
  chooseGpuTier,
} from '../perf/lod.js';
import { prepareUtterance } from '../synthesize.js';
import { AdaptiveStream } from './adaptive-stream.js';
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

/** The WebGPU device for a tier of a message, or null (CPU). */
function tierDevice(state, message, level) {
  return AUDIO_TIERS[level].solver === 'fdtd3d' && message.gpu !== false
    ? gpu(state)
    : null;
}

async function speak(state, message) {
  const device = message.auto
    ? null
    : await tierDevice(state, message, message.tier);
  const progress = { busy: 0, chunks: 0, gpu: Boolean(device) };
  try {
    if (message.auto) {
      await runAdaptive(state, message, progress);
    } else {
      await run(state, message, device, progress);
    }
  } catch (error) {
    if (!progress.gpu) {
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
    await speak(state, message);
  }
}

/**
 * The plan and render options of an utterance at tier `level`, and the
 * voxel model of a 3D tier.
 */
function prepareTier(state, message, level, device) {
  const tier = AUDIO_TIERS[level];
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
    articulationOffsets: message.articulationOffsets,
    seed: message.seed,
    tier: level,
    microphone: message.microphone,
    room: message.room,
    enclosure: message.enclosure,
    device: device ?? undefined,
    model,
    breaths: message.breaths,
    source: message.source,
    interaction:
      message.source === 'folds' && !device ? message.interaction : undefined,
    subglottal: message.subglottal,
    headroom: message.headroom,
  });
  return { ...prepared, model };
}

/** Set up the renderer and stream the utterance at a fixed tier. */
async function run(state, message, device, progress) {
  const { id } = message;
  const tier = AUDIO_TIERS[message.tier];
  // WebGPU is a separate JavaScript host/shader backend.
  const engine = await createEngine(device ? 'js' : engineOptions(message));
  const prepared = prepareTier(state, message, message.tier, device);
  const { model } = prepared;
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
        level: message.tier,
      });
    }
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
 * Render and post the chunks of an utterance at a fixed tier.
 * @returns {Promise<'done'|'cancelled'>}
 */
async function stream(state, message, renderer, progress) {
  const { id } = message;
  const chunkSize = message.chunkSize ?? 1024;
  const meter = new FieldMeter();
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
 * The highest tier the stream of a message may climb to (see the top of
 * this file).
 */
function maxTier(message) {
  if (message.maxTier !== undefined) {
    return Math.min(AUDIO_TIERS.length - 1, message.maxTier);
  }
  const { solver } = AUDIO_TIERS[message.tier];
  if (solver !== 'waveguide') {
    return message.tier;
  }
  return AUDIO_TIERS.findLastIndex((tier) => tier.solver === solver);
}

/**
 * The AdaptiveStream of an automatic utterance. Renderers get their voxel
 * model and GPU device per tier; `info` maps each to `{model, gpu}`.
 * Pieces of the heard renderer go to `fields.meter`, a fresh one after
 * every switch.
 */
async function openAdaptive(state, message, progress) {
  const engine = await createEngine(engineOptions(message));
  const info = new Map();
  const fields = { meter: new FieldMeter(), source: null, stream: null };
  const createRenderer = async (level, extra) => {
    const device = await tierDevice(state, message, level);
    progress.gpu ||= Boolean(device);
    const prepared = prepareTier(state, message, level, device);
    const backend = device ? await createEngine('js') : engine;
    const renderer = backend.createRenderer(prepared.plan, {
      ...prepared.renderOptions,
      ...extra,
    });
    info.set(renderer, { model: prepared.model, gpu: Boolean(device) });
    return renderer;
  };
  fields.stream = await AdaptiveStream.create({
    createRenderer,
    level: message.tier,
    streamRate: message.streamRate ?? 48000,
    room: Boolean(message.room || message.enclosure),
    renderOptions: { field: true },
    onRender: (renderer) => {
      if (renderer !== fields.stream?.renderer) {
        return;
      }
      if (renderer !== fields.source) {
        fields.meter = new FieldMeter();
        fields.source = renderer;
      }
      fields.meter.add(fieldSource(renderer));
    },
  });
  return { adaptive: fields.stream, info, fields };
}

/**
 * The level the governor proposes after a chunk, with its reason, or
 * null: one step down after an underrun, else what record() gives.
 */
function propose(state, id, governor, busy, audio) {
  if (state.underrun === id) {
    state.underrun = 0;
    const level = governor.underrun();
    return level === null ? null : { level, reason: 'underrun' };
  }
  const level = governor.record(busy, audio);
  if (level === null) {
    return null;
  }
  return { level, reason: level < governor.level ? 'load' : 'headroom' };
}

/** Let the governor change the tier of the stream between chunks. */
function govern(state, id, run, busy, audio) {
  const { adaptive, governor } = run;
  if (adaptive.switching) {
    return;
  }
  if (adaptive.level !== governor.level) {
    // The stream dropped the request: too close to the end.
    governor.switched(adaptive.level);
  }
  const proposal = propose(state, id, governor, busy, audio);
  if (proposal && adaptive.setLevel(proposal.level)) {
    governor.switched(proposal.level);
    run.reason = proposal.reason;
  }
}

/** Post a tier message for every switch the stream finished. */
function postSwitches(state, id, run) {
  const { adaptive, info } = run;
  while (run.posted < adaptive.switches.length) {
    const { at, from, level, gainDb } = adaptive.switches[run.posted++];
    const heard = info.get(adaptive.renderer) ?? {};
    state.post({
      type: 'tier',
      id,
      at,
      from,
      level,
      reason: run.reason,
      gainDb,
      solver: AUDIO_TIERS[level].solver,
      gpu: Boolean(heard.gpu),
      model: modelPayload(heard.model),
    });
  }
}

/**
 * Stream an utterance in automatic mode (see the top of this file).
 * @returns {Promise<'done'|'cancelled'>}
 */
async function runAdaptive(state, message, progress) {
  const { id } = message;
  const { adaptive, info, fields } = await openAdaptive(
    state,
    message,
    progress
  );
  const run = {
    adaptive,
    info,
    governor: new StreamGovernor({
      level: message.tier,
      maxLevel: maxTier(message),
    }),
    posted: 0,
    reason: null,
  };
  try {
    const first = adaptive.renderer;
    const heard = info.get(first);
    state.post({
      type: 'start',
      id,
      sampleRate: adaptive.streamRate,
      solver: AUDIO_TIERS[message.tier].solver,
      gpu: heard.gpu,
      totalSamples: adaptive.totalSamples,
      model: modelPayload(heard.model),
      engine: first.engine,
      fallbackReason: first.fallbackReason,
    });
    const chunkSize = message.chunkSize ?? 1024;
    while (!adaptive.done) {
      if (state.current !== id) {
        return 'cancelled';
      }
      const start = adaptive.position;
      const { level } = adaptive;
      const samples = new Float32Array(
        Math.min(chunkSize, adaptive.totalSamples - start)
      );
      const began = globalThis.performance.now();
      await adaptive.render(samples);
      const measured = (globalThis.performance.now() - began) / 1000;
      const audio = samples.length / adaptive.streamRate;
      const busy = state.busy(level, audio, measured);
      progress.busy += busy;
      postSwitches(state, id, run);
      state.post(
        ...chunkMessage(
          id,
          start,
          samples,
          samples.length,
          fields.meter.take(),
          busy / audio
        )
      );
      progress.chunks++;
      govern(state, id, run, busy, audio);
      await yieldToMessages();
    }
    state.post({
      type: 'end',
      id,
      load: progress.busy / adaptive.duration,
      level: adaptive.level,
    });
    return 'done';
  } finally {
    adaptive.close();
  }
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
  const engine = await createEngine('js');
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
 * @param {{requestGpuDevice?: () => Promise<object|null>, busy?: (level: number, audio: number, measured: number) => number}} [options]
 *   `requestGpuDevice` gives the WebGPU device (default: requestGpuDevice
 *   of src/acoustics/fdtd-gpu.js); `busy` gives the seconds a chunk of
 *   `audio` seconds at tier `level` counts as busy for the governor of
 *   automatic mode (default: `measured`, the seconds it took)
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
    /** The id of the utterance whose player ran dry, until handled. */
    underrun: 0,
    busy: options.busy ?? ((level, audio, measured) => measured),
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
    if (message.type === 'underrun') {
      if (message.id === state.current) {
        state.underrun = message.id;
      }
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
      state.underrun = 0;
      await speakNow(state, message).catch((error) => {
        post({ type: 'error', id: message.id, message: error.message });
      });
    }
  };
}
