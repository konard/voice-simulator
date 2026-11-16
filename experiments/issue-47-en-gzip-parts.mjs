#!/usr/bin/env node
/**
 * Issue 47: what the gzip bytes of en.js are made of. Encodes the shipped
 * English words with all variants, with the first variant only, and the
 * words of main's english-dict.js (when its path is given), and prints raw
 * and gzip bytes of each module text.
 *
 *   node experiments/issue-47-en-gzip-parts.mjs [path/to/english-dict.js]
 */
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { encodeVslex } from '../src/g2p/vslex.js';
import { lexiconFor, pronunciations } from '../src/g2p/lexicon.js';

const PHONEMES = /t͡ʃ|d͡ʒ|aɪ|aʊ|eɪ|oʊ|ɔɪ|./gu;
const units = (text) => text.match(PHONEMES);

function sizes(name, entries) {
  const data = encodeVslex('en', entries, { units });
  const text = JSON.stringify(data, null, 2);
  const variants = [...entries.values()].reduce((n, v) => n + v.length, 0);
  console.log(
    `${name}: ${entries.size} words, ${variants} pronunciations, ` +
      `${Buffer.byteLength(text)} raw, ${gzipSync(text, { level: 9 }).length} gzip`
  );
}

const all = new Map();
for (const word of lexiconFor('en').words()) {
  all.set(word, pronunciations('en', word));
}
sizes('shipped, all variants', all);
sizes(
  'shipped, first variant',
  new Map([...all].map(([word, ipa]) => [word, ipa.slice(0, 1)]))
);
const old = process.argv[2];
if (old) {
  const module = await import(pathToFileURL(old).href);
  const value = Object.values(module).flat().join(' ');
  const entries = new Map();
  for (const item of value.split(/\s+/)) {
    const [word, ipa] = item.split('=');
    if (word && ipa) {
      entries.set(word, ipa.split('|'));
    }
  }
  sizes('main english-dict.js words', entries);
  const text = await import('node:fs').then((fs) => fs.readFileSync(old));
  console.log(
    `main english-dict.js file: ${text.length} raw, ${gzipSync(text, { level: 9 }).length} gzip`
  );
}
