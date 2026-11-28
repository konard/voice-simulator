// Profile a bounded 5 s (or 60 s with --full) stream without waiting.
// Run with the same CPU affinity and Node heap cap as the certification row.
import { performance } from 'node:perf_hooks';
import { setTimeout as wait } from 'node:timers/promises';
import { createRecognizer, recognize, synthesize } from '../../src/index.js';
import { sentences } from '../../tests/helpers/roundtrip.js';

const rate = 8000;
const realTime = process.argv.includes('--realtime');
const signal = new Float32Array(
  (process.argv.includes('--full') ? 60 : 5) * rate
);
function speech(text, preset) {
  return synthesize(text, {
    tier: 'telephone',
    lang: 'en',
    head: 'random',
    preset,
    seed: 1,
    engine: 'js',
  }).samples;
}
for (let i = 0, offset = 0; offset < signal.length; i++) {
  const samples = speech(sentences.en[i % 20], i % 2 ? 'female' : 'male');
  signal.set(samples.subarray(0, signal.length - offset), offset);
  offset += samples.length + 0.3 * rate;
}

const options = { level: 'low', languages: ['en'], engine: 'js' };
recognize(speech('Hello world.', 'male'), rate, options);
const times = new Map();
const decodes = [];
let received = 0;
let firstPartial;
const stream = createRecognizer({
  ...options,
  sampleRate: rate,
  profile(stage, elapsed) {
    times.set(stage, (times.get(stage) ?? 0) + elapsed);
    if (stage === 'Audio to IPA') {
      decodes.push({ received: received / rate, ms: Math.round(elapsed) });
    }
  },
});
stream.on('partial', ({ text }) => {
  if (text) {
    firstPartial ??= received / rate;
  }
});
stream.on('error', (error) => {
  throw error;
});
const start = process.cpuUsage();
const wallStart = performance.now();
for (let i = 0; i < signal.length; i += 160) {
  if (realTime) {
    const delay = wallStart + (i * 1000) / rate - performance.now();
    if (delay > 0) {
      await wait(delay);
    }
  }
  received = i + 160;
  stream.push(signal.subarray(i, i + 160));
}
const { text } = stream.flush();
const { user, system } = process.cpuUsage(start);
const stagesMs = [...times].sort((a, b) => b[1] - a[1]);
console.log({
  text,
  firstPartial,
  cpuSeconds: (user + system) / 1e6,
  decodes,
  stagesMs,
});
