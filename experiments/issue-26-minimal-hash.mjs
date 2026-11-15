// SHA-256 of the samples of synthesize('Hi.', {tier: 'minimal', seed: 1}).
// The value printed on main before issue 26 is written into
// tests/narrow-band.test.js ("present tiers are unchanged").
// Usage: node experiments/issue-26-minimal-hash.mjs
import { createHash } from 'node:crypto';
import { synthesize } from '../src/index.js';

const { samples } = synthesize('Hi.', { tier: 'minimal', seed: 1 });
const bytes = new Uint8Array(
  samples.buffer,
  samples.byteOffset,
  samples.byteLength
);
console.log(createHash('sha256').update(bytes).digest('hex'));
