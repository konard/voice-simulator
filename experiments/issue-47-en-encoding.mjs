#!/usr/bin/env node
/**
 * Issue 47: raw and gzip bytes of the English vslex module under different
 * encoder options (pronunciation units, symbol merges), for the words of
 * the current src/g2p/lexicon/en.js. The package budget counts gzip bytes
 * (`npm pack`), the en.js budget raw bytes. Raw size is the JSON size plus
 * the line overhead Prettier adds (one line per array item).
 *
 *   node experiments/issue-47-en-encoding.mjs
 */
import { gzipSync } from 'node:zlib';
import { encodeVslex } from '../src/g2p/vslex.js';
import { lexiconFor, pronunciations } from '../src/g2p/lexicon.js';

const PHONEMES = /t͡ʃ|d͡ʒ|aɪ|aʊ|eɪ|oʊ|ɔɪ|./gu;
const phonemes = (text) => text.match(PHONEMES);
const entries = new Map();
for (const word of lexiconFor('en').words()) {
  entries.set(word, pronunciations('en', word));
}
function sizes(data) {
  const text = [
    ...Object.entries(data)
      .filter(([, value]) => !Array.isArray(value))
      .map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`),
    ...['values', 'first', 'blocks'].flatMap((key) => [
      `  ${key}: [`,
      ...data[key].map((item) => `    ${JSON.stringify(item)},`),
      '  ],',
    ]),
  ].join('\n');
  return `${Buffer.byteLength(text)} raw, ${gzipSync(text, { level: 9 }).length} gzip`;
}
for (const [name, options] of [
  ['code points, merges', {}],
  ['code points, no merges', { merge: false }],
  ['phonemes, merges', { units: phonemes }],
  ['phonemes, no merges', { units: phonemes, merge: false }],
]) {
  const data = encodeVslex('en', entries, options);
  console.log(`${name}: ${sizes(data)}, ${data.values.length} values`);
}
