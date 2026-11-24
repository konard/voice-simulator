/**
 * Rank of each word of the round-trip sentences in the recognition lexicon:
 * how many are outside the decoder vocabulary.
 * node experiments/issue-75-hmm-oov.mjs [maxWords]. Unlicense.
 */
import { tokenize } from '../src/index.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const maxWords = Number(process.argv[2] ?? 8000);
for (const lang of ['en', 'ru', 'hi', 'zh']) {
  const lexicon = getLexicon(lang);
  const rank = new Map(lexicon.words.map(({ word }, i) => [word, i]));
  let words = 0;
  const out = [];
  for (const text of sentences[lang]) {
    for (const word of tokenize(text, 'word')) {
      const key = word.toLowerCase();
      if (/^[\p{L}\p{M}]+$/u.test(key)) {
        words++;
        const r = rank.get(key);
        if (r === undefined || r >= maxWords) {
          out.push(`${key}:${r ?? '-'}`);
        }
      }
    }
  }
  console.log(
    `${lang}: ${out.length}/${words} outside ${maxWords}:`,
    out.join(' ')
  );
}
