// Hash of the waveguide output for a nasal phrase: the NoseLine refactor
// (issue 37) must leave it bit-identical.
// Usage: node experiments/issue-37-waveguide-hash.mjs
import { createHash } from 'node:crypto';
import { synthesize } from '../src/index.js';

for (const tier of ['minimal', 'medium']) {
  const { samples } = synthesize('ˈmama ˈnʌn ˈsiŋ', { ipa: true, tier });
  const hash = createHash('sha256')
    .update(Buffer.from(samples.buffer))
    .digest('hex');
  console.log(tier, samples.length, hash.slice(0, 16));
}
