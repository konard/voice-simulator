// Probe how the G2P pronounces words the text normaliser generates.
// Usage: node experiments/issue-5-probe-words.mjs [en|ru] [words...]
import { englishWordToIpa } from '../src/g2p/english.js';
import { russianWordToIpa } from '../src/g2p/russian.js';
import { hindiWordToIpa } from '../src/g2p/hindi.js';

const PRONOUNCERS = {
  en: englishWordToIpa,
  ru: russianWordToIpa,
  hi: hindiWordToIpa,
};
const [lang = 'en', ...words] = process.argv.slice(2);
for (const word of words) {
  const result = PRONOUNCERS[lang](word);
  console.log(word.padEnd(16), result.ipa.padEnd(20), result.source ?? '');
}
