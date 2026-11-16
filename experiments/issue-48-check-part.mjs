#!/usr/bin/env node
/**
 * Issue 48: check a part of ru-stress.txt against a slice of
 * data/lexicon/ru-counts.txt, the way src/g2p/russian.js reads it.
 *
 *   node experiments/issue-48-check-part.mjs PART FROM TO [--show]
 *
 * Prints items that do not parse or contradict each other, the number of
 * stems and forms, and the words of ranks FROM..TO (1-based, inclusive)
 * with two or more vowels that no item covers. `--show` prints every
 * covered word of the slice with `+` at the stress the items give, to
 * proofread.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRussianItem } from '../scripts/lexicon-ru.mjs';
import { RUSSIAN_ENDINGS } from '../src/g2p/russian.js';

const VOWELS = 'аеёиоуыэюя';
const count = (text) => [...text].filter((c) => VOWELS.includes(c)).length;
const [part, from, to] = process.argv.slice(2);
const forms = new Map();
const stems = new Map();
const errors = [];
for (const raw of readFileSync(part, 'utf8').split('\n')) {
  const line = raw.replace(/#.*$/u, '').trim();
  if (!line) {
    continue;
  }
  try {
    const item = parseRussianItem(line);
    const [map, key] =
      item.kind === 'form' ? [forms, item.word] : [stems, item.stem];
    if (map.has(key) && map.get(key).payload !== item.payload) {
      errors.push(`contradicts "${map.get(key).line}": ${line}`);
    }
    map.set(key, { ...item, line });
  } catch (error) {
    errors.push(error.message);
  }
}
const endings = new Set(RUSSIAN_ENDINGS);

function stressOf(word) {
  const form = forms.get(word);
  if (form) {
    return form.payload === 'z' ? count(word) - 1 : form.stress;
  }
  for (let cut = word.length; cut > 0; cut--) {
    const stem = stems.get(word.slice(0, cut));
    if (stem && endings.has(word.slice(cut))) {
      if (stem.payload !== '+') {
        return stem.stress;
      }
      const before = count(word.slice(0, cut));
      return count(word.slice(cut)) > 0 ? before : before - 1;
    }
  }
  return undefined;
}

function mark(word, stress) {
  let seen = 0;
  return [...word]
    .map((c) => (VOWELS.includes(c) && seen++ === stress ? `+${c}` : c))
    .join('');
}

const counts = readFileSync(
  fileURLToPath(import.meta.resolve('../data/lexicon/ru-counts.txt')),
  'utf8'
)
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split(' ')[0]);
const slice = counts.slice(Number(from) - 1, Number(to));
const missing = [];
const shown = [];
for (const word of slice) {
  if (count(word) < 2) {
    continue;
  }
  const stress = stressOf(word) ?? stressOf(word.replaceAll('е', 'ё'));
  if (stress === undefined) {
    missing.push(word);
  } else {
    shown.push(mark(word, stress));
  }
}
console.log(errors.join('\n'));
console.log(`stems: ${stems.size}, forms: ${forms.size}`);
console.log(`uncovered (${missing.length}): ${missing.join(' ')}`);
if (process.argv.includes('--show')) {
  console.log(shown.join('\n'));
}
