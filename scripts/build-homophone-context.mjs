#!/usr/bin/env node
/** Build English homophone context counts from the CC0 sentence collector. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { accentSettings } from '../src/accent/index.js';
import { textToIpa } from '../src/g2p/index.js';
import { getCounts } from '../src/recognition/data/index.js';
import { corpusWords } from './build-recognition-data.mjs';
import { TEXT } from './check-app-lowest.mjs';

const path = process.argv[2];
if (!path) {
  throw new Error('Pass the Common Voice English sentence-collector.txt path');
}

const ENGLISH = { lang: 'en', accent: accentSettings('en-US') };
const corpus = getCounts('en');
const entries = [...corpus.words, ...corpus.supplemental];
const vocabulary = new Set(entries.map(({ word }) => word));
const byIpa = new Map();
for (const word of vocabulary) {
  const { ipa } = textToIpa(word, ENGLISH);
  const list = byIpa.get(ipa) ?? [];
  list.push(word);
  byIpa.set(ipa, list);
}
const homophones = new Set(
  [...byIpa.values()].filter((list) => list.length > 1).flat()
);

function fourgrams(words) {
  return words.slice(3).map((_, i) => words.slice(i, i + 4).join(' '));
}

// Keep every sentence sharing four consecutive benchmark words out of the
// training counts, including near duplicates of benchmark sentences.
const holdout = new Set(fourgrams(corpusWords(TEXT, 'en')));
const pairs = new Map();
const counts = new Map();
let total = 0;
for (const sentence of readFileSync(path, 'utf8').split(/[.!?\n]+/u)) {
  const words = corpusWords(sentence, 'en');
  if (fourgrams(words).some((gram) => holdout.has(gram))) {
    continue;
  }
  total += words.length;
  for (const [i, word] of words.entries()) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
    const before = words[i - 1];
    if (
      vocabulary.has(before) &&
      vocabulary.has(word) &&
      (homophones.has(before) || homophones.has(word))
    ) {
      const pair = `${before} ${word}`;
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
  }
}

const packed = [...pairs]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([pair, count]) => {
    const [before, word] = pair.split(' ');
    const expected = (counts.get(before) * counts.get(word)) / total;
    const score = Math.round(100 * Math.log1p(count / (expected + 0.1)));
    return score >= 100 ? [`${pair.replace(' ', '/')}=${score}`] : [];
  })
  .flat();
const lines = [];
for (let i = 0; i < packed.length; i += 48) {
  lines.push(JSON.stringify(packed.slice(i, i + 48).join(' ')));
}
const output = fileURLToPath(
  new URL('../src/recognition/data/en-homophone-context.js', import.meta.url)
);
writeFileSync(
  output,
  `/** English homophone association scores from Common Voice CC0 text. See SOURCES.md. */\n` +
    `export const ASSOCIATIONS = [\n  ${lines.join(',\n  ')},\n].join(' ');\n`
);
