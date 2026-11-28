/** Check the compact word index against all four shipped language tables. */
import assert from 'node:assert/strict';
import { getCounts } from '../src/recognition/data/index.js';
import { WORDS as english } from '../src/recognition/data/en.js';
import { WORDS as hindi } from '../src/recognition/data/hi.js';
import { WORDS as russian } from '../src/recognition/data/ru.js';
import { WORDS as mandarin } from '../src/recognition/data/zh.js';
import { SPOKEN, SPOKEN_WORDS } from '../src/recognition/data/en-spoken.js';

function counts(source) {
  return source
    .split(' ')
    .filter(Boolean)
    .map((item) => {
      const at = item.lastIndexOf('=');
      return [item.slice(0, at), Number(item.slice(at + 1))];
    });
}

for (const [language, source] of [
  ['en', english],
  ['hi', hindi],
  ['ru', russian],
  ['zh', mandarin],
]) {
  const original = counts(source);
  const { ranked, wordCount } = getCounts(language);
  assert.equal(ranked.length, original.length);
  assert.equal(
    ranked.total,
    original.reduce((sum, [, value]) => sum + value, 0)
  );
  const ranks = new Map();
  original.forEach(([word], i) => ranks.set(word, i));
  const spoken = language === 'en' ? new Map(counts(SPOKEN)) : null;
  const scale = ranked.total / SPOKEN_WORDS;
  for (const [i, [word, value]] of original.entries()) {
    assert.equal(ranked.name(i), word);
    assert.equal(ranked.count(i), value);
    assert.equal(ranked.rank(word), ranks.get(word));
    assert.equal(wordCount(word), original[ranks.get(word)][1]);
    const prior = spoken ? Math.max(1, (spoken.get(word) ?? 0) * scale) : value;
    assert.equal(ranked.weight(i), prior);
  }
  assert.equal(ranked.rank('\0'), undefined);
  assert.equal(ranked.name(original.length), undefined);
  console.log(`${language}: ${original.length} words matched exactly`);
}
