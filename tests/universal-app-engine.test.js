/**
 * The app's voice engine and synthesis worker outside the browser: the
 * cached device benchmark and the early overload step-down.
 */

import { describe, it, expect } from 'test-anywhere';
import { VoiceEngine } from '../examples/universal-app/src/engine/voice-engine.js';

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
  it('starts at the tier cached by an earlier visit', () => {
    withStorage(() => {
      const worker = fakeWorker();
      const first = new VoiceEngine({ createWorker: () => worker });
      first.benchmark({});
      expect(first.status.phase).toBe('benchmark');
      expect(worker.posted[0].type).toBe('benchmark');
      worker.reply({ type: 'benchmark', level: 2, loads: [0.1, 0.2, 0.3] });
      expect(first.audioLevel).toBe(2);

      const second = new VoiceEngine({ createWorker: fakeWorker });
      second.benchmark({});
      expect(second.status.phase).toBe('idle');
      expect(second.audioLevel).toBe(2);
      expect(second.status.cachedBenchmark).toBe(true);
    });
  });

  it('follows the worker when it steps down early', () => {
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

/** The worker's message handler, from a single import of the module. */
let workerHandler = null;

/**
 * Run the worker on a speak message until it ends, with `navigator.gpu`
 * and `performance.now` replaced while it runs; returns what it posted.
 */
async function speakInWorker(message, { gpu, now } = {}) {
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
    if (!workerHandler) {
      globalThis.addEventListener = (type, listener) => {
        workerHandler = listener;
      };
      await import('../examples/universal-app/src/engine/synth-worker.js');
    }
    workerHandler({
      data: { type: 'speak', lang: 'en', head: {}, ...message },
    });
    for (let wait = 0; wait < 400; wait++) {
      if (posted.some((data) => data.type === 'end' || data.type === 'error')) {
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
    // Every chunk "takes" 60 ms: far slower than real time on every tier.
    const posted = await speakInWorker(
      { id: 1, ipa: 'ˈa', seed: 1, tier: 3, auto: true, gpu: false },
      { now: () => (clock += 30) }
    );
    const steps = posted
      .filter((message) => message.type === 'overload')
      .map((message) => [message.from, message.level]);
    expect(steps.length > 0).toBe(true);
    expect(steps[0][0]).toBe(3);
    expect(steps.at(-1)[1]).toBe(0);
    const starts = posted.filter((message) => message.type === 'start');
    expect(starts.at(-1).solver).toBe('waveguide');
    expect(posted.at(-1).type).toBe('end');
  });

  it('keeps the 3D tiers on the CPU when the GPU is turned off', async () => {
    const posted = await speakInWorker(
      { id: 2, ipa: 'ˈa', seed: 1, tier: 3, auto: false, gpu: false },
      { gpu: brokenGpu }
    );
    const starts = posted.filter((message) => message.type === 'start');
    expect(starts.length).toBe(1);
    expect(starts[0].solver).toBe('fdtd3d');
    expect(starts[0].gpu).toBe(false);
    expect(posted.at(-1).type).toBe('end');
  });

  it('falls back to the CPU when the GPU fails', async () => {
    const posted = await speakInWorker(
      { id: 3, ipa: 'ˈa', seed: 1, tier: 3, auto: false },
      { gpu: brokenGpu }
    );
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
});
