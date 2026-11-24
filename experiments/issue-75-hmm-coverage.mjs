/**
 * Lexicon ranks of the round-trip sentence words: how many fall outside the
 * top N words of each language, and which are missing altogether.
 * node experiments/issue-75-hmm-coverage.mjs. Unlicense.
 */
import { tokenize } from '../src/index.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { sentences } from '../tests/helpers/roundtrip.js';

for (const lang of ['en', 'ru', 'hi']) {
  const { words } = getLexicon(lang);
  const rank = new Map(words.map(({ word }, i) => [word, i]));
  const ranks = [];
  const missing = [];
  for (const text of sentences[lang]) {
    for (const w of tokenize(text, 'word')) {
      const key = w.toLowerCase();
      if (!/^[\p{L}\p{M}]+$/u.test(key)) {
        continue;
      }
      const r = rank.get(key);
      if (r === undefined) {
        missing.push(key);
      } else {
        ranks.push([key, r]);
      }
    }
  }
  const over = (n) => ranks.filter(([, r]) => r >= n).length;
  console.log(
    lang,
    'lexicon',
    words.length,
    'tokens',
    ranks.length + missing.length,
    'over 8k',
    over(8000),
    '20k',
    over(20000),
    '50k',
    over(50000),
    '100k',
    over(100000),
    'missing',
    missing.length,
    missing.join(' ')
  );
  console.log(
    '  ranks >20k:',
    ranks
      .filter(([, r]) => r >= 20000)
      .map(([w, r]) => `${w}:${r}`)
      .join(' ')
  );
}
