/** Lexicon coverage of the roundtrip corpus words. Unlicense. */
import { getCounts } from '../src/recognition/data/index.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { textToIpa } from '../src/index.js';
for (const lang of Object.keys(sentences)) {
  const c = getCounts(lang);
  const rank = new Map(c.words.map((w, i) => [w.word, i]));
  let n = 0;
  const miss = [];
  const ranks = [];
  for (const s of sentences[lang]) {
    const { words } = textToIpa(s, { lang });
    for (const w of words) {
      n++;
      const k = w.original.toLowerCase();
      const r = rank.get(k);
      if (r === undefined) {
        miss.push(k);
      } else {
        ranks.push(r);
      }
    }
  }
  ranks.sort((a, b) => a - b);
  console.log(
    lang,
    'sentences',
    sentences[lang].length,
    'words',
    n,
    'missing',
    miss.length,
    miss.slice(0, 15).join(' '),
    'median rank',
    ranks[ranks.length >> 1],
    'p90',
    ranks[Math.floor(ranks.length * 0.9)],
    'bigrams',
    Object.keys(c.bigrams ?? {}).length
  );
}
