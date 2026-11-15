// Issue 35: SHA-256 of the samples of phrases with fricatives, stops and
// aspiration at several tiers (seed 1). Run with Node.js, Bun and Deno and
// compare: the noise sources must give the same samples everywhere.
// Usage: node|bun|deno run -A experiments/issue-35-runtime-hashes.mjs
import { createHash } from 'node:crypto';
import { synthesize } from '../src/synthesize.js';

const cases = [
  ['Hi.', { tier: 'minimal' }],
  ['She sells sea shells, the fox thinks.', { tier: 'minimal' }],
  ['Peter took a cup of hot coffee.', { tier: 'low' }],
  [
    'ˈasa ˈaʃa ˈafa ˈaθa ˈaxa ˈpʰa ˈtʰa ˈkʰa ˈba',
    { ipa: true, tier: 'medium' },
  ],
  ['ˈasa ˈaha ˈpʰa', { ipa: true, tier: 'minimal', source: 'folds' }],
];
for (const [text, options] of cases) {
  const { samples } = synthesize(text, { seed: 1, ...options });
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength
  );
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  console.log(
    `${options.tier.padEnd(7)} ${hash} ${text}${options.source ? ` (${options.source})` : ''}`
  );
}
