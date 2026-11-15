// Issue 35: dump the samples of 'Hi.' at tier minimal (seed 1) as raw
// float32, to find the first sample where two runtimes differ.
// Usage: node|bun|deno run -A experiments/issue-35-runtime-diff.mjs out.f32
import fs from 'node:fs';
import { synthesize } from '../src/synthesize.js';

const { samples } = synthesize('Hi.', { tier: 'minimal', seed: 1 });
fs.writeFileSync(
  process.argv[2],
  new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
);
