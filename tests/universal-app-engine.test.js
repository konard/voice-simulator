/**
 * The app's voice engine and synthesis worker outside the browser: the
 * cached device benchmark, the tier switches of a running utterance
 * (issue 29) and the restart on the CPU when WebGPU fails.
 */

import { describe, it, expect } from 'test-anywhere';
import { VoiceEngine } from '../examples/universal-app/src/engine/voice-engine.js';
import { AUDIO_TIERS, BASE_AUDIO_LEVEL, audioTierIndex } from '../src/index.js';
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

function withStorage(run) {
  const items = new Map();
  const storage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (before) {
      Object.defineProperty(globalThis, 'localStorage', before);
    } else {
      delete globalThis.localStorage;
    }
  }
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

  it('starts at the tier cached by an earlier visit', () => {
    withStorage(() => {
      const worker = fakeWorker();
      const first = new VoiceEngine({ createWorker: () => worker });
      first.benchmark({});
      expect(first.status.phase).toBe('benchmark');
      // The worker is asked which engine renders as soon as it starts.
      expect(worker.posted.map((message) => message.type)).toEqual([
        'engine',
        'benchmark',
      ]);
      worker.reply({ type: 'benchmark', level: 2, loads: [0.1, 0.2, 0.3] });
      expect(first.audioLevel).toBe(2);

      const second = new VoiceEngine({ createWorker: fakeWorker });
      second.benchmark({});
      expect(second.status.phase).toBe('idle');
      expect(second.audioLevel).toBe(2);
      expect(second.status.cachedBenchmark).toBe(true);
    });
  });

  it('keeps the 3D tiers on the CPU when the benchmark found it faster', async () => {
    withStorage(() => {
      const worker = fakeWorker();
      const engine = new VoiceEngine({ createWorker: () => worker });
      engine.benchmark({}, { gpu: false });
      expect(postedOf(worker, 'benchmark')[0].gpu).toBe(false);
      worker.reply({ type: 'benchmark', level: 3, loads: [], gpu: false });
      engine.benchmark({});
      expect(engine.status.phase).toBe('benchmark');
      expect(postedOf(worker, 'benchmark')[1].gpu).toBe(true);
    });
    const worker = fakeWorker();
    const engine = new VoiceEngine({ createWorker: () => worker });
    engine.player = {
      unlock: async () => {},
      stalled: () => false,
      begin() {},
      stop() {},
    };
    const request = { text: 'ˈa', ipa: true, lang: 'en', head: {}, seed: '1' };
    engine.benchmark({});
    worker.reply({ type: 'benchmark', level: 3, loads: [], gpu: false });
    await engine.speak({ ...request, mode: 'sound' });
    expect(worker.posted.at(-1).gpu).toBe(false);
    worker.reply({ type: 'benchmark', level: 5, loads: [], gpu: true });
    await engine.speak({ ...request, mode: 'sound' });
    expect(worker.posted.at(-1).gpu).toBe(undefined);
    engine.setTier(5);
    worker.reply({ type: 'benchmark', level: 3, loads: [], gpu: false });
    await engine.speak({ ...request, mode: 'sound' });
    expect(worker.posted.at(-1).gpu).toBe(undefined);
  });

  it('renders with the engine setting and shows the engine', async () => {
    await withStorage(async () => {
      const worker = fakeWorker();
      const engine = new VoiceEngine({ createWorker: () => worker });
      engine.benchmark({});
      expect(postedOf(worker, 'engine')).toEqual([
        { type: 'engine', engine: 'auto' },
      ]);
      expect(engine.status.engine).toBe(null);
      worker.reply({
        type: 'engine',
        name: 'rust',
        simd: false,
        threads: 1,
        reason: null,
      });
      expect(engine.status.engine).toEqual({
        name: 'rust',
        simd: false,
        reason: null,
        error: null,
      });
      worker.reply({ type: 'benchmark', level: 3, loads: [0.1] });
      // Another engine: asked again, and measured again (its own cache).
      engine.benchmark({}, { engine: 'js' });
      expect(engine.status.engine).toBe(null);
      expect(postedOf(worker, 'engine').at(-1).engine).toBe('js');
      expect(postedOf(worker, 'benchmark').at(-1).engine).toBe('js');
      expect(engine.status.phase).toBe('benchmark');
      engine.player = {
        unlock: async () => {},
        stalled: () => false,
        begin() {},
        stop() {},
      };
      const request = {
        text: 'ˈa',
        ipa: true,
        lang: 'en',
        head: {},
        seed: '1',
      };
      await engine.speak({ ...request, mode: 'sound' });
      expect(worker.posted.at(-1).engine).toBe('js');
      await engine.speak({ ...request, mode: 'sound', engine: 'rust' });
      expect(worker.posted.at(-1).engine).toBe('rust');
    });
  });

  it('restarts on the CPU when WebGPU fails', () => {
    const worker = fakeWorker();
    const engine = new VoiceEngine({ createWorker: () => worker });
    engine.benchmark({});
    worker.reply({ type: 'benchmark', level: 4, loads: [] });
    engine.job = { id: 7, chunks: [{}], fields: [{}], fieldIndex: 1 };
    worker.reply({ type: 'overload', id: 7, from: 4, level: 3, load: 1.5 });
    expect(engine.audioLevel).toBe(3);
    expect(engine.status.overloads).toBe(1);
    expect(engine.job.chunks).toEqual([]);
  });
});

describe('voice engine tier switches', () => {
  it('follows the tier switches of a running utterance', async () => {
    const worker = fakeWorker();
    const engine = new VoiceEngine({ createWorker: () => worker });
    let underruns = 0;
    let time = 0;
    engine.player = {
      context: { sampleRate: 44100 },
      unlock: async () => {},
      stalled: () => false,
      begin() {},
      push() {},
      end() {},
      stop() {},
      time: () => time,
      get underruns() {
        return underruns;
      },
    };
    const job = await engine.speak({
      text: 'ˈmama',
      ipa: true,
      lang: 'en',
      head: {},
      seed: '1',
      mode: 'sound',
    });
    const speak = postedOf(worker, 'speak')[0];
    expect(speak.streamRate).toBe(44100);
    expect(speak.auto).toBe(true);
    const { id } = job;
    worker.reply({
      type: 'start',
      id,
      sampleRate: 44100,
      solver: 'waveguide',
      totalSamples: 44100,
    });
    worker.reply({
      type: 'tier',
      id,
      at: 0.3,
      from: BASE_AUDIO_LEVEL,
      level: BASE_AUDIO_LEVEL + 1,
      reason: 'headroom',
      gainDb: 0.3,
      solver: 'waveguide',
      gpu: false,
      model: null,
    });
    // The next utterance starts at the new tier; the HUD waits for playback.
    expect(engine.audioLevel).toBe(BASE_AUDIO_LEVEL + 1);
    expect(engine.status.switches).toBe(1);
    expect(engine.status.audioLevel).toBe(BASE_AUDIO_LEVEL);
    time = 0.2;
    engine.frame();
    expect(engine.status.audioLevel).toBe(BASE_AUDIO_LEVEL);
    time = 0.31;
    engine.frame();
    expect(engine.status.audioLevel).toBe(BASE_AUDIO_LEVEL + 1);
    // The player ran dry: the worker hears it once per underrun.
    underruns = 1;
    engine.frame();
    engine.frame();
    expect(postedOf(worker, 'underrun')).toEqual([{ type: 'underrun', id }]);
    worker.reply({ type: 'end', id, load: 0.1, level: BASE_AUDIO_LEVEL });
    expect(engine.audioLevel).toBe(BASE_AUDIO_LEVEL);
    // After the end the player plays out what it holds: nothing to report.
    underruns = 2;
    engine.frame();
    expect(postedOf(worker, 'underrun').length).toBe(1);
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
async function speakInWorker(message, { gpu, now, fresh } = {}) {
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
      if (posted.some((data) => FINAL.has(data.type))) {
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
  it('steps a running utterance down as soon as it falls behind', async () => {
    let clock = 0;
    // Every clock reading "takes" 100 ms, so a 1024-sample chunk takes at
    // least 100 ms: far slower than real time on every tier (21 ms of
    // audio at 48 kHz).
    const posted = await speakInWorker(
      { id: 1, ipa: 'ˈa', seed: 1, tier: HIGH, auto: true, gpu: false },
      { now: () => (clock += 100) }
    );
    const starts = posted.filter((message) => message.type === 'start');
    expect(starts.length).toBe(1);
    expect(starts[0].solver).toBe('fdtd3d');
    expect(posted.some((message) => message.type === 'overload')).toBe(false);
    const tiers = posted.filter((message) => message.type === 'tier');
    expect(tiers.length > 0).toBe(true);
    expect(tiers[0].from).toBe(HIGH);
    expect(tiers[0].reason).toBe('load');
    expect(tiers.at(-1).solver).toBe('waveguide');
    expect(tiers.every((tier) => tier.level < tier.from)).toBe(true);
    const samples = posted
      .filter((message) => message.type === 'chunk')
      .reduce((sum, message) => sum + message.samples.length, 0);
    expect(samples).toBe(starts[0].totalSamples);
    expect(posted.at(-1).type).toBe('end');
    expect(posted.at(-1).level).toBe(tiers.at(-1).level);
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

  it('benchmarks the CPU alone when the GPU fails', async () => {
    const warnings = [];
    const warn = console.warn;
    console.warn = (text) => warnings.push(text);
    let posted;
    try {
      posted = await speakInWorker(
        { type: 'benchmark' },
        { gpu: brokenGpu, fresh: 'benchmark' }
      );
    } finally {
      console.warn = warn;
    }
    expect(warnings).toEqual(['WebGPU benchmark failed, measuring the CPU']);
    const reply = posted.find((message) => message.type === 'benchmark');
    expect(reply.gpu).toBe(false);
    expect(reply.loads[0] > 0).toBe(true);
    expect(posted.some((message) => message.type === 'error')).toBe(false);
  });
});
