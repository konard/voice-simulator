#!/usr/bin/env node
/**
 * Issue 48: the share of held-out words (every fifth word of
 * data/lexicon/ru-stress.txt, see splitGuessWords()) that the guess
 * table stresses right, for several table settings: the longest ending,
 * the fewest words an ending needs and the share of them that must agree.
 *
 *   node experiments/issue-48-guess-params.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  readRussianStress,
  russianGuessTable,
  splitGuessWords,
} from '../scripts/lexicon-ru.mjs';

const VOWELS = 'аеёиоуыэюя';
const vowelCount = (text) =>
  [...text].filter((char) => VOWELS.includes(char)).length;
const { words } = readRussianStress(
  readFileSync(
    fileURLToPath(import.meta.resolve('../data/lexicon/ru-stress.txt')),
    'utf8'
  )
);
const { counted, heldOut } = splitGuessWords(words);

function guess(table, word, longest) {
  const vowels = vowelCount(word);
  for (let length = Math.min(longest, word.length - 1); length >= 2; length--) {
    const fromEnd = table.get(word.slice(-length));
    if (fromEnd !== undefined && fromEnd < vowels) {
      return vowels - 1 - fromEnd;
    }
  }
  return Math.max(0, vowels - 2);
}

for (const longest of [4, 5, 6]) {
  for (const minWords of [2, 3, 5, 10]) {
    for (const agree of [0.5, 0.6, 0.75]) {
      const rows = russianGuessTable(counted, { minWords, agree, longest });
      const table = new Map(
        rows.flatMap((endings, fromEnd) =>
          endings
            .split(' ')
            .filter(Boolean)
            .map((ending) => [ending, fromEnd])
        )
      );
      const right = heldOut.filter(
        ([word, stress]) => guess(table, word, longest) === stress
      ).length;
      console.log(
        `longest ${longest} minWords ${minWords} agree ${agree}: ` +
          `${table.size} endings, ${right}/${heldOut.length} ` +
          `(${((100 * right) / heldOut.length).toFixed(1)} %)`
      );
    }
  }
}
