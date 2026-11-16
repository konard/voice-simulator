#!/usr/bin/env node
/**
 * Issue 48: print words of data/lexicon/ru-counts.txt (ranks FROM to TO)
 * with the stress the program gives them, `+` before the stressed vowel,
 * and the source in brackets when it is not the lexicon, for proofreading.
 *
 *   node experiments/issue-48-mark-top.mjs FROM TO
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findRussianStress } from '../src/index.js';

const VOWELS = 'аеёиоуыэюя';
const [from, to] = process.argv.slice(2).map(Number);
const words = readFileSync(
  fileURLToPath(import.meta.resolve('../data/lexicon/ru-counts.txt')),
  'utf8'
)
  .split('\n')
  .map((line) => line.split(/\s+/u)[0])
  .slice(from - 1, to);
const out = [];
for (const word of words) {
  const { letters, stress, vowels, source } = findRussianStress(word);
  if (vowels < 2) {
    continue;
  }
  let index = -1;
  let marked = '';
  for (const char of letters) {
    if (VOWELS.includes(char) && ++index === stress) {
      marked += '+';
    }
    marked += char;
  }
  out.push(
    source === 'dictionary' || source === 'morphology'
      ? marked
      : `${marked}(${source[0]})`
  );
}
console.log(out.join(' '));
