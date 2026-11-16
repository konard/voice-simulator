#!/usr/bin/env node
/**
 * Issue 47: bytes of the English vslex module under different encoder
 * options (pronunciation units, block size), for the words of the current
 * src/g2p/lexicon/en.js. Prints the JSON size plus the line overhead that
 * Prettier adds (one line per array item).
 *
 *   node experiments/issue-47-en-encoding.mjs
 */
import { encodeVslex } from '../src/g2p/vslex.js';
import { lexiconFor, pronunciations } from '../src/g2p/lexicon.js';

const PHONEMES = /t͡ʃ|d͡ʒ|aɪ|aʊ|eɪ|oʊ|ɔɪ|./gu;
const entries = new Map();
for (const word of lexiconFor('en').words()) {
  entries.set(word, pronunciations('en', word));
}
const size = (data) =>
  JSON.stringify(data).length +
  6 * (data.first.length + data.blocks.length + data.values.length);
for (const [name, options] of [
  ['code points, 64', {}],
  ['phonemes, 64', { units: (text) => text.match(PHONEMES) }],
  ['code points, 128', { blockSize: 128 }],
  ['phonemes, 128', { units: (text) => text.match(PHONEMES), blockSize: 128 }],
]) {
  const data = encodeVslex('en', entries, options);
  console.log(`${name}: ${size(data)} bytes, ${data.values.length} values`);
}
