// SHA-256 of the samples of synthesize('Hello world.', {seed: 1, tier}) on
// both engines (issue 29: offline output must stay bit-identical).
// Usage: node experiments/issue-29-offline-hashes.mjs
import { createHash } from 'node:crypto';
import { synthesize } from '../src/index.js';

for (const engine of ['js', 'rust']) {
  for (const tier of ['minimal', 'high']) {
    const result = synthesize('Hello world.', { seed: 1, tier, engine });
    const { samples } = result;
    const hash = createHash('sha256')
      .update(
        new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
      )
      .digest('hex');
    console.log(engine, tier, samples.length, result.engine ?? '', hash);
  }
}
