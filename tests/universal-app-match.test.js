/** Exercise the app's actual matching worker protocol. Unlicense, issue 63. */
import { it, expect } from 'test-anywhere';
import { synthesize } from '../src/index.js';
it('the matching worker emits progress and a fitted voice', async () => {
  const messages = [];
  let handle;
  const saved = Object.fromEntries(
    ['addEventListener', 'postMessage'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ])
  );
  Object.defineProperty(globalThis, 'addEventListener', {
    configurable: true,
    value: (kind, fn) => {
      if (kind === 'message') {
        handle = fn;
      }
    },
  });
  Object.defineProperty(globalThis, 'postMessage', {
    configurable: true,
    value: (message) => messages.push(message),
  });
  try {
    await import('../examples/universal-app/src/engine/match-worker.js');
    const audio = synthesize('Hello.', {
      head: { pitch: 210, vocalTractLength: 14 },
      sampleRate: 16000,
      solver: 'waveguide',
    });
    handle({
      data: {
        samples: audio.samples,
        sampleRate: audio.sampleRate,
        transcript: 'Hello.',
        iterations: 1,
      },
    });
    expect(messages.some((m) => m.type === 'step')).toBe(true);
    const done = messages.at(-1);
    expect(done.type).toBe('done');
    expect(done.head.pitch > 150).toBe(true);
    expect(Number.isFinite(done.distance)).toBe(true);
    expect(done.features.voicedDuration > 0).toBe(true);
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key]) {
        Object.defineProperty(globalThis, key, saved[key]);
      } else {
        delete globalThis[key];
      }
    }
  }
});
