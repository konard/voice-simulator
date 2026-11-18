// Unlicense. Issue 63: cost of one fitVoice evaluation (render, stage A
// statistics of the render, MCD) for the voice-match test sentence.
// Usage: node render-cost.mjs [js|auto]
import { performance } from 'node:perf_hooks';
import { synthesize, DEFAULT_HEAD } from '../../src/index.js';
import {
  accumulate,
  emptyState,
} from '../../src/analysis/voice-fit-statistics.js';
import { createMcdMetric } from '../../src/analysis/voice-fit-objective.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const engine = process.argv[2] ?? 'js';
const render = () =>
  synthesize(TEXT, {
    head: DEFAULT_HEAD,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    lang: 'en',
    engine,
  });
const time = (label, fn, n = 3) => {
  const t0 = performance.now();
  let out;
  for (let i = 0; i < n; i++) {
    out = fn();
  }
  console.log(`${label}: ${((performance.now() - t0) / n).toFixed(1)} ms`);
  return out;
};
const { samples } = time('synthesize', render);
console.log(`audio ${(samples.length / 16000).toFixed(2)} s`);
time('accumulate (stage A of the render)', () =>
  accumulate(emptyState(), samples, 16000, {}, false, () => {})
);
const mcd = createMcdMetric(Float32Array.from(samples), 16000);
time('mcd', () => mcd(samples));
