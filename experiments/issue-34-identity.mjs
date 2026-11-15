/**
 * Prints a hash of renders without interaction on every solver (the LF
 * default and the folds), so that they can be checked bit-identical
 * before and after issue 34: run it here and on main and compare.
 *
 *   node experiments/issue-34-identity.mjs
 */
import { createHash } from 'node:crypto';
import { synthesize } from '../src/index.js';

const CASES = [
  ['Hello.', { tier: 'minimal' }],
  ['Hello, how are you?', { tier: 'medium', seed: 3 }],
  ['Hello.', { tier: 'high' }],
  ['ˈapa', { ipa: true, solver: 'fdtd2d', sampleRate: 24000 }],
  ['Hello.', { tier: 'medium', source: 'folds' }],
  ['ˈaba', { ipa: true, tier: 'high', source: 'folds' }],
  ['ˈama', { ipa: true, solver: 'fdtd2d', source: 'folds' }],
];

for (const [text, options] of CASES) {
  const result = synthesize(text, options);
  const hash = createHash('sha256')
    .update(new Uint8Array(result.samples.buffer))
    .digest('hex')
    .slice(0, 16);
  console.log(
    `${hash}  ${result.samples.length}  ${text} ${JSON.stringify(options)}`
  );
}
