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

describe('synthesis worker', () => {
  it('restarts an utterance on a cheaper tier as soon as it falls behind', async () => {
    const posted = [];
    let handler = null;
    let clock = 0;
    const saved = {
      postMessage: globalThis.postMessage,
      addEventListener: globalThis.addEventListener,
      now: globalThis.performance.now,
    };
    globalThis.postMessage = (message) => posted.push(message);
    globalThis.addEventListener = (type, listener) => {
      handler = listener;
    };
    // Every chunk "takes" 60 ms: far slower than real time on every tier.
    globalThis.performance.now = () => (clock += 30);
    try {
      await import('../examples/universal-app/src/engine/synth-worker.js');
      handler({
        data: {
          type: 'speak',
          id: 1,
          ipa: 'ˈa',
          lang: 'en',
          head: {},
          seed: 1,
          tier: 3,
          auto: true,
        },
      });
      for (let wait = 0; wait < 200; wait++) {
        if (posted.some((message) => message.type === 'end')) {
          break;
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 20));
      }
    } finally {
      globalThis.postMessage = saved.postMessage;
      globalThis.addEventListener = saved.addEventListener;
      globalThis.performance.now = saved.now;
    }
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
});
