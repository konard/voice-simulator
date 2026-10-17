// Check that every accent's output parses without unknown IPA symbols.
import { textToIpa } from '../src/g2p/index.js';
import { ACCENTS } from '../src/g2p/accents.js';
import { parseIpa } from '../src/ipa/parse.js';

const text =
  'The quick brown fox, thirty three cars and four apples: water, bath, tune, nurse, square, father, go home!';
for (const { code } of ACCENTS.en) {
  const { ipa } = textToIpa(text, { lang: 'en', accent: code });
  console.log(code, ipa, parseIpa(ipa).unknown);
}
