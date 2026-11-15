/**
 * Prints a hash of LF renders, so that the default source can be checked
 * bit-identical before and after a change (issue 33).
 *
 *   node experiments/issue-33-lf-identity.mjs
 */
import { createHash } from 'node:crypto';
import { synthesize } from '../src/index.js';

const CASES = [
  ['Hello.', { tier: 'minimal' }],
  ['Hello, how are you?', { tier: 'medium', seed: 3 }],
  ['Привет, мир.', { tier: 'low', head: 'random', seed: 5 }],
  ['ˈmama ʔa', { tier: 'minimal', ipa: true }],
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
