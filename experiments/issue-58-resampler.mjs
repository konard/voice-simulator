// createResampler (issue 58): chunked output against resample() of the whole
// input, and its speed. Usage: node experiments/issue-58-resampler.mjs
import { createResampler, createRandom, resample } from '../src/index.js';

const random = createRandom('issue-58-resampler');
for (const [from, to] of [[44100, 16000], [48000, 16000], [22050, 11025], [16000, 8000], [11025, 8000], [8000, 16000], [44100.5, 16000]]) {
  const input = Float32Array.from({ length: from * 2 | 0 }, () => random() * 2 - 1);
  const whole = resample(input, from, to);
  const stream = createResampler(from, to);
  const parts = [];
  const sizes = [1, 7, 160, 1024];
  let started = performance.now();
  for (let pos = 0, i = 0; pos < input.length; pos += sizes[i++ % 4]) {
    parts.push(stream.push(input.subarray(pos, pos + sizes[i % 4])));
  }
  parts.push(stream.flush());
  const ms = performance.now() - started;
  const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { joined.set(p, offset); offset += p.length; }
  let diff = joined.length === whole.length ? 0 : Infinity;
  for (let n = 0; n < whole.length; n++) diff = Math.max(diff, Math.abs(joined[n] - whole[n]));
  console.log(`${from} -> ${to}: ${joined.length}/${whole.length} samples, max difference ${diff.toExponential(2)}, ${(ms / 2000).toFixed(4)} s per s`);
}
