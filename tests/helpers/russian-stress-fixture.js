/**
 * Issue 48: how many words of tests/fixtures/russian-stress.txt get the
 * stress marked by hand when read with the marks removed. Used by
 * tests/russian-stress.test.js and experiments/issue-48-fixture-share.mjs.
 *
 * Every word part with a `+` is counted, except the unstressed
 * prepositions and particles of src/g2p/russian-clitics.js (`через`,
 * `перед`, ...), which issue 86 reads without stress. The stressed vowel
 * of a reading is the number of IPA vowels before `ˈ`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { textToIpa } from '../../src/index.js';
import {
  RUSSIAN_ENCLITICS,
  RUSSIAN_PROCLITICS,
} from '../../src/g2p/russian-clitics.js';
import { isRussianHomograph } from '../../src/g2p/russian-homographs.js';

const VOWEL = /[aeiouɨəɐɪʊɛɔ]/gu;

function stressIndex(ipa) {
  const mark = ipa.indexOf('ˈ');
  return mark < 0 ? -1 : (ipa.slice(0, mark).match(VOWEL) ?? []).length;
}

/** The marked sentences of the fixture. */
export function russianFixtureLines() {
  return readFileSync(
    fileURLToPath(import.meta.resolve('../fixtures/russian-stress.txt')),
    'utf8'
  )
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'));
}

/**
 * Read every fixture sentence with and without its marks.
 * @returns {{sentences: number, all: {right: number, total: number},
 *   homograph: {right: number, total: number}, wrong: string[]}}
 *   `homograph` counts the words whose spelling is in
 *   `RUSSIAN_HOMOGRAPHS`; `wrong` lists `marked IPA got plain IPA`.
 */
export function measureRussianFixture() {
  const lines = russianFixtureLines();
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
      const counters = isRussianHomograph(lower.replaceAll('ё', 'е'))
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
  return { sentences: lines.length, all, homograph, wrong };
}
