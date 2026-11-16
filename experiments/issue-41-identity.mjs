/**
 * Hashes of rendered samples for a set of options: run before and after a
 * change that should not alter the default output and compare the lines.
 *   node experiments/issue-41-identity.mjs
 */
import { createHash } from 'node:crypto';
import { synthesize } from '../src/index.js';

const CASES = [
  ['ˈmama ˈsasa', { ipa: true, tier: 'minimal' }],
  ['ˈapa ˈtata, ˈkaka ˈfafa.', { ipa: true, tier: 'minimal' }],
  ['ˈa', { ipa: true, tier: 'minimal', source: 'folds', interaction: true }],
  ['ˈmasa ˈsu ˈaza', { ipa: true, tier: 'minimal', preset: 'female' }],
  ['hello world, how are you?', { lang: 'en', tier: 'minimal' }],
  ['привет мир', { lang: 'ru', tier: 'minimal' }],
  ['你好', { lang: 'zh', tier: 'minimal' }],
  [
    'ˈasa',
    {
      ipa: true,
      tier: 'minimal',
      microphone: { distance: 50 },
      room: 'office',
    },
  ],
  ['ˈasa', { ipa: true, tier: 'low' }],
];

for (const [text, options] of CASES) {
  const result = synthesize(text, { seed: 3, ...options });
  const hash = createHash('sha256')
    .update(Buffer.from(result.samples.buffer))
    .digest('hex')
    .slice(0, 16);
  console.log(
    `${hash} ${result.samples.length} ${text} ${JSON.stringify(options)}`
  );
}
