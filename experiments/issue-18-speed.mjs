// Acceptance check of issue 18: comparing two 5-second recordings takes less
// than 5 seconds on one core. Usage: node experiments/issue-18-speed.mjs
import { performance } from 'node:perf_hooks';
import { synthesize } from '../src/index.js';
import { compareRecordings } from '../src/metrics/index.js';

const TEXT =
  'The north wind and the sun were disputing which was the stronger, when a traveller came along wrapped in a warm cloak.';

function fiveSeconds(seed, head) {
  const result = synthesize(TEXT, { tier: 'minimal', seed, head });
  const length = Math.round(5 * result.sampleRate);
  const samples = new Float32Array(length);
  samples.set(result.samples.subarray(0, length));
  return { samples, sampleRate: result.sampleRate, rendered: result.duration };
}

const a = fiveSeconds(1);
const b = fiveSeconds(2, { pitch: 220 });
console.log(
  `recordings: ${(a.samples.length / a.sampleRate).toFixed(2)} s and ${(b.samples.length / b.sampleRate).toFixed(2)} s at ${a.sampleRate} Hz (rendered ${a.rendered.toFixed(2)} s and ${b.rendered.toFixed(2)} s)`
);
for (let run = 1; run <= 3; run++) {
  const start = performance.now();
  const result = compareRecordings(a, b);
  const seconds = (performance.now() - start) / 1000;
  console.log(
    `run ${run}: ${seconds.toFixed(2)} s, frames ${result.frames.reference}x${result.frames.test}, MCD ${result.mcd.toFixed(2)} dB, LSD ${result.lsd.toFixed(2)} dB, F0 RMSE ${result.f0.rmseCents.toFixed(0)} cents`
  );
}
