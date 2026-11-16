/**
 * The app's voice engine and synthesis worker outside the browser: the
 * cached device benchmark and the early overload step-down.
 */

import { describe, it, expect } from 'test-anywhere';
import { VoiceEngine } from '../examples/universal-app/src/engine/voice-engine.js';
import {
  BENCHMARK_KEY,
  BENCHMARK_MAX_AGE,
  TIER_KEY,
  readTierSetting,
} from '../examples/universal-app/src/engine/benchmark-cache.js';
import {
  AUDIO_TIERS,
  BASE_AUDIO_LEVEL,
  BENCHMARK_VERSION,
  audioTierIndex,
  startLevel,
} from '../src/index.js';
import { createWorkerHandler } from '../src/engine/worker-protocol.js';

const HIGH = audioTierIndex('high');

function fakeWorker() {
  const worker = {
    posted: [],
    listeners: [],
    addEventListener(type, listener) {
      if (type === 'message') {
        worker.listeners.push(listener);
      }
    },
    postMessage(message) {
      worker.posted.push(message);
    },
    reply(data) {
      for (const listener of worker.listeners) {
        listener({ data });
      }
    },
    terminate() {},
  };
  return worker;
}

/** The messages of one type the engine posted to its worker. */
function postedOf(worker, type) {
  return worker.posted.filter((message) => message.type === type);
}

/**
 * Run `run` (sync or async) with a fresh localStorage in globalThis; the
 * storage is passed to it.
 */
function withStorage(run) {
  const items = new Map();
  const storage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  const restore = () => {
    if (before) {
      Object.defineProperty(globalThis, 'localStorage', before);
    } else {
      delete globalThis.localStorage;
    }
  };
  let result;
  try {
    result = run(storage);
  } catch (error) {
    restore();
    throw error;
  }
  if (typeof result?.then === 'function') {
    return result.finally(restore);
  }
  restore();
  return result;
}

/** The worker's answer to {type: 'engine'} for the Rust engine. */
const RUST = { name: 'rust', simd: true, threads: 1 };
const JS = { name: 'js', simd: false, threads: 1 };

/** A complete benchmark answer of the worker (benchmarkDevice). */
function answer(level, fields = {}) {
  return {
    type: 'benchmark',
    version: BENCHMARK_VERSION,
    engine: RUST,
    level,
    loads: [0.1, 0.2, 0.3],
    measured: [true, true, true],
    gpu: false,
    gpuPending: false,
    ...fields,
  };
}

/**
 * An engine on a fake worker whose idle moments come when the test calls
 * `idle()`; `engine` answers {type: 'engine'} at once unless null.
 */
function benchmarkEngine({ engine = RUST } = {}) {
  const worker = fakeWorker();
  const runs = [];
  const voice = new VoiceEngine({
    createWorker: () => worker,
    idle: (run) => {
      runs.push(run);
      return () => runs.splice(runs.indexOf(run), 1);
    },
  });
  voice.player = {
    unlock: async () => {},
    stalled: () => false,
    begin() {},
    stop() {},
    end() {},
  };
  const idle = () => runs.splice(0).forEach((run) => run());
  const reply = (data) => worker.reply(data);
  const start = (head = {}, options = {}) => {
    voice.benchmark(head, options);
    if (engine) {
      reply({ type: 'engine', ...engine, reason: null });
    }
  };
  return { worker, engine: voice, idle, runs, reply, start };
}

/** An utterance in the sound mode; returns its id. */
async function speakSound(engine) {
  const job = await engine.speak({
    text: 'ˈa',
    ipa: true,
    lang: 'en',
    head: {},
    seed: '1',
    mode: 'sound',
  });
  return job.id;
}

describe('voice engine benchmark', () => {
  it('starts automatic quality at minimal, above the narrow-band tiers', () => {
    const engine = new VoiceEngine({ createWorker: fakeWorker });
    expect(engine.auto).toBe(true);
    expect(engine.audioLevel).toBe(BASE_AUDIO_LEVEL);
    expect(engine.status.audioLevel).toBe(BASE_AUDIO_LEVEL);
    expect(AUDIO_TIERS[engine.audioLevel].name).toBe('minimal');
    engine.setTier(audioTierIndex('telephone'));
    expect(AUDIO_TIERS[engine.audioLevel].name).toBe('telephone');
  });

  it('measures at an idle moment, silently, and caches the result', () => {
    withStorage((storage) => {
      const { worker, engine, idle, reply, start } = benchmarkEngine();
      start();
      // The worker is asked which engine renders as soon as it starts; the
      // benchmark waits for an idle moment.
      expect(worker.posted.map((message) => message.type)).toEqual(['engine']);
      expect(engine.audioLevel).toBe(startLevel(globalThis.navigator ?? {}));
      const changes = [];
      engine.onChange = (status) => changes.push(status);
      idle();
      expect(postedOf(worker, 'benchmark').length).toBe(1);
      expect(engine.status.benchmark.measuring).toBe(true);
      expect(engine.status.phase).toBe('idle');
      // No re-render of the app until the answer (a render is a long task
      // at 4x CPU throttling).
      expect(changes.length).toBe(0);
      reply(answer(2));
      expect(changes.length).toBe(1);
      expect(engine.audioLevel).toBe(2);
      expect(engine.status.phase).toBe('idle');
      expect(engine.status.benchmark.measuring).toBe(false);
      expect(engine.status.benchmark.engine).toEqual(RUST);
      const cached = JSON.parse(storage.items.get(BENCHMARK_KEY));
      expect(Object.keys(cached).sort()).toEqual(
        [
          'device',
          'engine',
          'gpu',
          'level',
          'loads',
          'measured',
          'time',
          'version',
        ].sort()
      );
      expect(cached.version).toBe(BENCHMARK_VERSION);
      expect(cached.level).toBe(2);
      expect(cached.engine).toEqual(RUST);
    });
  });

  it('waits for the engine to load before the idle moment', () => {
    withStorage(() => {
      const { worker, runs, idle, reply, start } = benchmarkEngine({
        engine: null,
      });
      start();
      // Its answer re-renders the app: not inside the benchmark window.
      expect(runs.length).toBe(0);
      reply({ type: 'engine', ...RUST, reason: null });
      expect(runs.length).toBe(1);
      idle();
      expect(postedOf(worker, 'benchmark').length).toBe(1);
    });
  });

  it('a valid cache sends no benchmark', () => {
    withStorage(() => {
      const first = benchmarkEngine();
      first.start();
      first.idle();
      first.reply(answer(2));

      const second = benchmarkEngine();
      second.start();
      second.idle();
      expect(second.runs.length).toBe(0);
      expect(postedOf(second.worker, 'benchmark')).toEqual([]);
      expect(second.engine.audioLevel).toBe(2);
      expect(second.engine.status.benchmark.cached).toBe(true);
      expect(second.engine.status.phase).toBe('idle');
    });
  });

  it('a new BENCHMARK_VERSION measures again', () => {
    withStorage((storage) => {
      const first = benchmarkEngine();
      first.start();
      first.idle();
      first.reply(answer(2));
      const cached = JSON.parse(storage.items.get(BENCHMARK_KEY));
      storage.setItem(
        BENCHMARK_KEY,
        JSON.stringify({ ...cached, version: BENCHMARK_VERSION - 1 })
      );

      const second = benchmarkEngine();
      second.start();
      expect(second.engine.audioLevel).toBe(
        startLevel(globalThis.navigator ?? {})
      );
      second.idle();
      expect(postedOf(second.worker, 'benchmark').length).toBe(1);
    });
  });

  it('another engine measures again', () => {
    withStorage(() => {
      const first = benchmarkEngine();
      first.start();
      first.idle();
      first.reply(answer(2));

      // Another build: no SIMD this time.
      const second = benchmarkEngine({ engine: { ...RUST, simd: false } });
      second.start();
      second.idle();
      expect(postedOf(second.worker, 'benchmark').length).toBe(1);

      // The same engine, with the answer to {type: 'engine'} coming later.
      const third = benchmarkEngine({ engine: null });
      third.start();
      third.idle();
      expect(postedOf(third.worker, 'benchmark')).toEqual([]);
      third.reply({ type: 'engine', ...RUST, threads: 4, reason: null });
      third.idle();
      expect(postedOf(third.worker, 'benchmark').length).toBe(1);
    });
  });

  it('a cache older than 30 days measures again', () => {
    withStorage((storage) => {
      const first = benchmarkEngine();
      first.start();
      first.idle();
      first.reply(answer(2));
      const cached = JSON.parse(storage.items.get(BENCHMARK_KEY));
      storage.setItem(
        BENCHMARK_KEY,
        JSON.stringify({ ...cached, time: Date.now() - BENCHMARK_MAX_AGE - 1 })
      );

      const second = benchmarkEngine();
      second.start();
      second.idle();
      expect(postedOf(second.worker, 'benchmark').length).toBe(1);
    });
  });
});

describe('voice engine benchmark cache', () => {
  it('three overloads drop the cache', async () => {
    await withStorage(async (storage) => {
      const first = benchmarkEngine();
      first.start();
      first.idle();
      first.reply(answer(4));

      const second = benchmarkEngine();
      second.start();
      const overload = async (expected) => {
        second.engine.governor.level = 4;
        const id = await speakSound(second.engine);
        expect(postedOf(second.worker, 'speak').at(-1).tier).toBe(4);
        second.reply({ type: 'overload', id, from: 4, level: 3, load: 1.5 });
        // A second step-down of the same utterance does not count.
        second.reply({ type: 'overload', id, from: 3, level: 2, load: 1.5 });
        second.reply({ type: 'end', id });
        expect(storage.items.has(BENCHMARK_KEY)).toBe(expected);
      };
      await overload(true);
      await overload(true);
      // An utterance without one starts the count again.
      second.engine.governor.level = 4;
      const id = await speakSound(second.engine);
      second.reply({ type: 'end', id });
      await overload(true);
      await overload(true);
      await overload(false);
      expect(second.engine.status.benchmark).toBe(null);

      const third = benchmarkEngine();
      third.start();
      third.idle();
      expect(postedOf(third.worker, 'benchmark').length).toBe(1);
    });
  });

  it('speech before the answer starts at the start level', async () => {
    await withStorage(async () => {
      const { worker, engine, idle, reply, start } = benchmarkEngine();
      start();
      await speakSound(engine);
      const first = postedOf(worker, 'speak')[0];
      expect(first.tier).toBe(startLevel(globalThis.navigator ?? {}));
      expect(first.auto).toBe(true);
      idle();
      reply(answer(5, { gpuPending: true }));
      expect(engine.audioLevel).toBe(5);
      reply(answer(6, { gpu: true }));
      expect(engine.audioLevel).toBe(6);
    });
  });

  it('posts the benchmark after an utterance in progress', async () => {
    await withStorage(async () => {
      const { worker, engine, idle, start } = benchmarkEngine();
      start();
      await speakSound(engine);
      idle();
      expect(postedOf(worker, 'benchmark')).toEqual([]);
      engine.stop();
      idle();
      expect(postedOf(worker, 'benchmark').length).toBe(1);
    });
  });

  it('caches the answer with the WebGPU tiers, not the CPU one', () => {
    withStorage((storage) => {
      const { idle, reply, start } = benchmarkEngine();
      start();
      idle();
      reply(answer(5, { gpuPending: true }));
      expect(storage.items.has(BENCHMARK_KEY)).toBe(false);
      reply(answer(6, { gpu: true }));
      expect(JSON.parse(storage.items.get(BENCHMARK_KEY)).level).toBe(6);
    });
  });
});

describe('voice engine debug', () => {
  it('keeps the utterance times the debug long tasks leave out', async () => {
    const { engine } = benchmarkEngine();
    const before = globalThis.performance.now();
    expect(engine.duringSpeech(before - 10, before - 5)).toBe(false);
    const speaking = engine.speak({
      text: 'ˈa',
      ipa: true,
      lang: 'en',
      head: {},
      seed: '1',
      mode: 'visual',
    });
    expect(engine.duringSpeech(before + 1e6, before + 1e6 + 1)).toBe(true);
    await speaking;
    engine.stop();
    const after = globalThis.performance.now();
    expect(engine.speechSpans.length).toBe(1);
    expect(engine.duringSpeech(before, after)).toBe(true);
    expect(engine.duringSpeech(after + 1, after + 2)).toBe(false);
    // A failed utterance ends its span too.
    const failed = await engine.speak(null).catch((error) => error);
    expect(failed instanceof TypeError).toBe(true);
    expect(engine.speechFrom).toBe(null);
  });
});

describe('voice engine quality settings', () => {
  it('a fixed tier survives a reload', () => {
    withStorage((storage) => {
      const first = benchmarkEngine();
      first.engine.setTier(HIGH);
      expect(storage.items.get(TIER_KEY)).toBe('high');

      const second = benchmarkEngine();
      expect(second.engine.auto).toBe(false);
      expect(second.engine.audioLevel).toBe(HIGH);
      second.start();
      second.idle();
      // The benchmark still runs, but does not change the level.
      expect(postedOf(second.worker, 'benchmark').length).toBe(1);
      second.reply(answer(2));
      expect(second.engine.audioLevel).toBe(HIGH);
      second.engine.setTier(null);
      expect(storage.items.get(TIER_KEY)).toBe('auto');
      expect(second.engine.audioLevel).toBe(2);

      // A stored 'auto' or an unknown name reads as 'auto'.
      expect(readTierSetting()).toBe('auto');
      expect(benchmarkEngine().engine.auto).toBe(true);
      storage.items.set(TIER_KEY, 'no-such-tier');
      expect(readTierSetting()).toBe('auto');
    });
  });

  it('measure again forgets the cache and measures now', () => {
    withStorage((storage) => {
      const first = benchmarkEngine();
      first.start();
      first.idle();
      first.reply(answer(2));
      const changes = [];
      first.engine.onChange = (status) => changes.push(status);
      first.engine.measureAgain();
      expect(storage.items.has(BENCHMARK_KEY)).toBe(false);
      expect(postedOf(first.worker, 'benchmark').length).toBe(2);
      // The button shows the measurement at once.
      expect(changes.at(-1).benchmark.measuring).toBe(true);
      first.reply(answer(3));
      expect(JSON.parse(storage.items.get(BENCHMARK_KEY)).level).toBe(3);
    });
  });

  it('a low battery caps automatic quality at medium', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        getBattery: async () => ({ charging: false, level: 0.1 }),
      },
      configurable: true,
      writable: true,
    });
    try {
      const { engine, idle, reply, start } = benchmarkEngine();
      await Promise.resolve();
      start();
      idle();
      reply(answer(HIGH));
      expect(engine.audioLevel).toBe(audioTierIndex('medium'));
    } finally {
      if (saved) {
        Object.defineProperty(globalThis, 'navigator', saved);
      } else {
        delete globalThis.navigator;
      }
    }
  });

  it('keeps the 3D tiers on the CPU when the benchmark found it faster', async () => {
    const { worker, engine, idle, reply, start } = benchmarkEngine();
    start({}, { gpu: false });
    idle();
    expect(postedOf(worker, 'benchmark')[0].gpu).toBe(false);
    start({});
    idle();
    expect(postedOf(worker, 'benchmark')[1].gpu).toBe(true);
    reply(answer(3, { gpu: false }));
    await speakSound(engine);
    expect(worker.posted.at(-1).gpu).toBe(false);
    reply(answer(5, { gpu: true }));
    await speakSound(engine);
    expect(worker.posted.at(-1).gpu).toBe(undefined);
    engine.setTier(5);
    reply(answer(3, { gpu: false }));
    await speakSound(engine);
    expect(worker.posted.at(-1).gpu).toBe(undefined);
  });

  it('renders with the engine setting and shows the engine', async () => {
    await withStorage(async () => {
      const { worker, engine, idle, reply } = benchmarkEngine();
      engine.benchmark({});
      expect(postedOf(worker, 'engine')).toEqual([
        { type: 'engine', engine: 'auto' },
      ]);
      expect(engine.status.engine).toBe(null);
      reply({ type: 'engine', ...RUST, reason: null });
      expect(engine.status.engine).toEqual({
        ...RUST,
        reason: null,
        error: null,
      });
      idle();
      reply(answer(3));
      // Another engine: asked again, and measured again (its own cache).
      engine.benchmark({}, { engine: 'js' });
      expect(engine.status.engine).toBe(null);
      expect(postedOf(worker, 'engine').at(-1).engine).toBe('js');
      // The benchmark waits for the engine to load in the worker.
      idle();
      expect(postedOf(worker, 'benchmark').length).toBe(1);
      reply({ type: 'engine', ...JS, reason: null });
      idle();
      expect(postedOf(worker, 'benchmark').length).toBe(2);
      expect(postedOf(worker, 'benchmark').at(-1).engine).toBe('js');
      expect(engine.status.phase).toBe('idle');
      await speakSound(engine);
      expect(worker.posted.at(-1).engine).toBe('js');
      await engine.speak({
        text: 'ˈa',
        ipa: true,
        lang: 'en',
        head: {},
        seed: '1',
        mode: 'sound',
        engine: 'rust',
      });
      expect(worker.posted.at(-1).engine).toBe('rust');
    });
  });

  it('follows the worker when it steps down early', () => {
    const { engine, idle, reply, start } = benchmarkEngine();
    start();
    idle();
    reply(answer(4));
    engine.job = { id: 7, chunks: [{}], fields: [{}], fieldIndex: 1 };
    reply({ type: 'overload', id: 7, from: 4, level: 3, load: 1.5 });
    expect(engine.audioLevel).toBe(3);
    expect(engine.status.overloads).toBe(1);
    expect(engine.job.chunks).toEqual([]);
  });
});

describe('voice engine modes', () => {
  const request = {
    text: 'ˈmama',
    ipa: true,
    lang: 'en',
    head: {},
    seed: '1',
  };
  const quietPlayer = {
    unlock: async () => {},
    stalled: () => false,
    begin() {},
    stop() {},
  };

  it('animates without sound in the visual mode', async () => {
    const worker = fakeWorker();
    const engine = new VoiceEngine({ createWorker: () => worker });
    engine.player = quietPlayer;
    const job = await engine.speak({ ...request, mode: 'visual' });
    expect(job.sound).toBe(false);
    expect(worker.posted.some((message) => message.type === 'speak')).toBe(
      false
    );
    const frame = engine.frame();
    expect(frame.speaking).toBe(true);
    expect(frame.plan.segments.length > 0).toBe(true);
  });

  it('simulates the sound in the sound and both modes', async () => {
    for (const mode of ['sound', 'both']) {
      const worker = fakeWorker();
      const engine = new VoiceEngine({ createWorker: () => worker });
      engine.player = quietPlayer;
      const job = await engine.speak({ ...request, mode, gpu: false });
      expect(job.sound).toBe(true);
      const speak = worker.posted.find((message) => message.type === 'speak');
      expect(speak.ipa).toBe('ˈmama');
      expect(speak.gpu).toBe(false);
    }
  });

  it('shows when the worker simulates on the GPU', async () => {
    const worker = fakeWorker();
    const engine = new VoiceEngine({ createWorker: () => worker });
    engine.player = quietPlayer;
    const job = await engine.speak({ ...request, mode: 'sound' });
    worker.reply({
      type: 'start',
      id: job.id,
      sampleRate: 16000,
      solver: 'fdtd3d',
      gpu: true,
      totalSamples: 100,
    });
    expect(engine.status.solver).toBe('fdtd3d · GPU');
  });
});

/** Replies after which the worker is done with a message. */
const FINAL = new Set(['end', 'error', 'benchmark']);

/** The worker's message handler, shared by the tests. */
let workerHandler = null;

/**
 * Message handler of a worker (createWorkerHandler, the module the app's
 * synth-worker.js runs); `fresh` makes a separate one, whose WebGPU device
 * has not been requested yet.
 */
async function workerInstance(fresh) {
  if (workerHandler && !fresh) {
    return workerHandler;
  }
  const handle = createWorkerHandler((data, transfer) =>
    globalThis.postMessage(data, transfer)
  );
  const handler = (event) => handle(event.data);
  if (!fresh) {
    workerHandler = handler;
  }
  return handler;
}

/**
 * Run the worker on a speak (or other) message until it ends, with
 * `navigator.gpu` and `performance.now` replaced while it runs; returns
 * what it posted.
 */
async function speakInWorker(
  message,
  { gpu, now, fresh, until = (data) => FINAL.has(data.type) } = {}
) {
  const posted = [];
  const saved = {
    postMessage: globalThis.postMessage,
    addEventListener: globalThis.addEventListener,
    now: globalThis.performance.now,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  globalThis.postMessage = (data) => posted.push(data);
  if (now) {
    globalThis.performance.now = now;
  }
  if (gpu !== undefined) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { gpu },
      configurable: true,
      writable: true,
    });
  }
  try {
    const handler = await workerInstance(fresh);
    handler({
      data: { type: 'speak', lang: 'en', head: {}, ...message },
    });
    for (let wait = 0; wait < 400; wait++) {
      if (posted.some(until)) {
        break;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 20));
    }
  } finally {
    globalThis.postMessage = saved.postMessage;
    globalThis.addEventListener = saved.addEventListener;
    globalThis.performance.now = saved.now;
    if (saved.navigator) {
      Object.defineProperty(globalThis, 'navigator', saved.navigator);
    } else {
      delete globalThis.navigator;
    }
  }
  return posted;
}

/** A WebGPU whose device fails as soon as the solver uses it. */
const brokenGpu = {
  async requestAdapter() {
    const limits = {
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
    };
    return {
      limits,
      requestDevice: async () => ({
        limits,
        createBuffer() {
          throw new Error('device lost');
        },
      }),
    };
  },
};

describe('synthesis worker', () => {
  it('restarts an utterance on a cheaper tier as soon as it falls behind', async () => {
    let clock = 0;
    // Every clock reading "takes" 100 ms, so a 1024-sample chunk takes at
    // least 100 ms: far slower than real time on every wide-band tier
    // (46 ms of audio at 22.05 kHz).
    const posted = await speakInWorker(
      { id: 1, ipa: 'ˈa', seed: 1, tier: HIGH, auto: true, gpu: false },
      { now: () => (clock += 100) }
    );
    const steps = posted
      .filter((message) => message.type === 'overload')
      .map((message) => [message.from, message.level]);
    expect(steps.length > 0).toBe(true);
    expect(steps[0][0]).toBe(HIGH);
    // An overloaded device may go down to the narrow-band tiers.
    expect(steps.at(-1)[1]).toBe(audioTierIndex('telephone'));
    const starts = posted.filter((message) => message.type === 'start');
    expect(starts.at(-1).solver).toBe('waveguide');
    expect(posted.at(-1).type).toBe('end');
  });

  it('keeps the 3D tiers on the CPU when the GPU is turned off', async () => {
    const posted = await speakInWorker(
      { id: 2, ipa: 'ˈa', seed: 1, tier: HIGH, auto: false, gpu: false },
      { gpu: brokenGpu }
    );
    const starts = posted.filter((message) => message.type === 'start');
    expect(starts.length).toBe(1);
    expect(starts[0].solver).toBe('fdtd3d');
    expect(starts[0].gpu).toBe(false);
    expect(posted.at(-1).type).toBe('end');
  });

  it('falls back to the CPU when the GPU fails', async () => {
    // The fallback warns. The warning is captured and asserted, so it does
    // not reach the test log as an unexplained error.
    const warnings = [];
    const warn = console.warn;
    console.warn = (text, error) => warnings.push([text, error?.message]);
    let posted;
    try {
      posted = await speakInWorker(
        { id: 3, ipa: 'ˈa', seed: 1, tier: HIGH, auto: false },
        { gpu: brokenGpu }
      );
    } finally {
      console.warn = warn;
    }
    expect(warnings).toEqual([
      ['WebGPU synthesis failed, using the CPU', 'device lost'],
    ]);
    expect(posted.some((message) => message.type === 'error')).toBe(false);
    const starts = posted.filter((message) => message.type === 'start');
    expect(starts.at(-1).solver).toBe('fdtd3d');
    expect(starts.at(-1).gpu).toBe(false);
    const samples = posted
      .filter((message) => message.type === 'chunk')
      .reduce((sum, message) => sum + message.samples.length, 0);
    expect(samples).toBe(starts.at(-1).totalSamples);
    expect(posted.at(-1).type).toBe('end');
  });

  it('benchmarks the tiers on the CPU when the GPU is turned off', async () => {
    const posted = await speakInWorker(
      { type: 'benchmark', gpu: false },
      { gpu: brokenGpu }
    );
    const [reply] = posted;
    expect(reply.type).toBe('benchmark');
    expect(reply.gpu).toBe(false);
    expect(reply.gpuLoads.every((load) => load === null)).toBe(true);
    expect(reply.loads[0] > 0).toBe(true);
    expect(reply.level >= 0).toBe(true);
  });

  it('stops the benchmark while speaking and continues after', async () => {
    const posted = [];
    const handle = createWorkerHandler((data) =>
      posted.push({ type: data.type, at: globalThis.performance.now() })
    );
    const done = handle({ type: 'benchmark', gpu: false, engine: 'js' });
    // Speech arrives while the benchmark runs.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 5));
    const spoken = handle({
      type: 'speak',
      id: 1,
      ipa: 'ˈa',
      lang: 'en',
      head: {},
      seed: 1,
      tier: 0,
      auto: false,
      gpu: false,
      engine: 'js',
    });
    await Promise.all([done, spoken]);
    const end = posted.find((message) => message.type === 'end');
    expect(end !== undefined).toBe(true);
    for (let wait = 0; wait < 300; wait++) {
      if (posted.some((message) => message.type === 'benchmark')) {
        break;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 20));
    }
    const answer = posted.find((message) => message.type === 'benchmark');
    // The rest is measured 500 ms after the utterance.
    expect(answer.at - end.at).toBeGreaterThanOrEqual(450);
  });

  it('benchmarks the CPU alone when the GPU fails', async () => {
    const warnings = [];
    const warn = console.warn;
    console.warn = (text) => warnings.push(text);
    let posted;
    try {
      posted = await speakInWorker(
        // A low CPU level, so the 3D tiers are left to the GPU.
        { type: 'benchmark', engine: 'js' },
        {
          gpu: brokenGpu,
          fresh: 'benchmark',
          until: (data) => data.type === 'benchmark' && !data.gpuPending,
        }
      );
    } finally {
      console.warn = warn;
    }
    const replies = posted.filter((message) => message.type === 'benchmark');
    // The CPU answer comes first; the 3D tiers on WebGPU follow it.
    expect(replies.length).toBe(2);
    expect(replies[0].gpuPending).toBe(true);
    expect(replies[0].gpu).toBe(false);
    expect(replies[0].loads[0] > 0).toBe(true);
    expect(warnings).toEqual(['WebGPU benchmark failed']);
    expect(replies[1].gpuPending).toBe(false);
    expect(replies[1].gpu).toBe(false);
    expect(replies[1].level).toBe(replies[0].level);
    expect(posted.some((message) => message.type === 'error')).toBe(false);
  });
});
