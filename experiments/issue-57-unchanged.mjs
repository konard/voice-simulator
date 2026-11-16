/**
 * Issue 57: the output without an accent is unchanged. Prints the IPA and a
 * hash of the samples (tier medium, seed 1) of each language's sample
 * sentence and some accent-sensitive words, for the checkout given as the
 * first argument (default: this one).
 * Run: node experiments/issue-57-unchanged.mjs [path/to/checkout]
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? '.');
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { textToIpa, LANGUAGES } = await load('src/g2p/index.js');
const { synthesize } = await load('src/synthesize.js');

const texts = [
  ...Object.entries(LANGUAGES).map(([lang, info]) => [lang, info.sample]),
  ['en', 'the thing with strong street wives and bad bed'],
  ['en', 'Water, please.'],
  ['ru', 'город снег друг его хорошо'],
  ['hi', 'ज़रा फ़ोन शहर'],
  ['zh', '是四一点儿女儿'],
];
for (const [lang, text] of texts) {
  const { ipa } = textToIpa(text, { lang });
  const { samples } = synthesize(text, { lang, tier: 'medium', seed: 1 });
  const hash = createHash('sha256')
    .update(Buffer.from(samples.buffer))
    .digest('hex')
    .slice(0, 16);
  console.log(`${lang}\t${ipa}\t${hash}`);
}
