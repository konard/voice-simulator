#!/usr/bin/env node
/**
 * Issue 48: the share of words of tests/fixtures/russian-stress.txt that
 * get the stress marked by hand, read with the marks removed.
 *
 *   node experiments/issue-48-fixture-share.mjs [--wrong]
 *
 * Every word part with a `+` is counted, except the unstressed
 * prepositions and particles of src/g2p/russian-clitics.js (`через`,
 * `перед`, ...), which issue 86 reads without stress. The stressed vowel
 * of a reading is the number of IPA vowels before `ˈ`. `--wrong` lists the
 * words that differ. Works on any commit: the homograph share is printed
 * only when src/g2p/russian-homographs.js exists.
 */

import { readFileSync } from 'node:fs';
import { textToIpa } from '../src/index.js';
import {
  RUSSIAN_ENCLITICS,
  RUSSIAN_PROCLITICS,
} from '../src/g2p/russian-clitics.js';

const VOWEL = /[aeiouɨəɐɪʊɛɔ]/gu;

function stressIndex(ipa) {
  const mark = ipa.indexOf('ˈ');
  return mark < 0 ? -1 : (ipa.slice(0, mark).match(VOWEL) ?? []).length;
}

async function homographSpellings() {
  try {
    const { RUSSIAN_HOMOGRAPHS } =
      await import('../src/g2p/russian-homographs.js');
    return new Set(
      RUSSIAN_HOMOGRAPHS.flatMap(([forms]) =>
        forms.map((pair) => pair.split('/')[0].replaceAll('+', ''))
      )
    );
  } catch {
    return undefined;
  }
}

const lines = readFileSync(
  new URL('../tests/fixtures/russian-stress.txt', import.meta.url),
  'utf8'
)
  .split('\n')
  .filter((line) => line.trim() && !line.startsWith('#'));
const homographs = await homographSpellings();
const all = { right: 0, total: 0 };
const homograph = { right: 0, total: 0 };
const wrong = [];
for (const line of lines) {
  const marked = textToIpa(line, { lang: 'ru' }).words;
  const plain = textToIpa(line.replaceAll('+', ''), { lang: 'ru' }).words;
  if (marked.length !== plain.length) {
    throw new Error(`different words: ${line}`);
  }
  marked.forEach((word, index) => {
    const lower = plain[index].text.toLowerCase();
    if (
      !word.original?.includes('+') ||
      Object.hasOwn(RUSSIAN_PROCLITICS, lower) ||
      Object.hasOwn(RUSSIAN_ENCLITICS, lower)
    ) {
      return;
    }
    const right = stressIndex(plain[index].ipa) === stressIndex(word.ipa);
    const counters = homographs?.has(lower.replaceAll('ё', 'е'))
      ? [all, homograph]
      : [all];
    for (const counter of counters) {
      counter.total++;
      counter.right += right ? 1 : 0;
    }
    if (!right) {
      wrong.push(`${word.original} ${word.ipa} got ${plain[index].ipa}`);
    }
  });
}
const share = ({ right, total }) =>
  `${right}/${total} (${((100 * right) / total).toFixed(1)} %)`;
console.log(`sentences: ${lines.length}`);
console.log(`all words: ${share(all)}`);
if (homographs) {
  console.log(`homograph words: ${share(homograph)}`);
}
if (process.argv.includes('--wrong')) {
  console.log(wrong.join('\n'));
}
