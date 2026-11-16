#!/usr/bin/env node
/**
 * Issue 47: what kind of reading errors remain on the held-out AISHELL-3
 * lines (every tenth line of train/content.txt).
 *
 *   node experiments/issue-47-zh-errors.mjs <content.txt> <unihan dir>
 *
 * Each misread syllable is put in one class:
 *   reading   the transcript reading is a reading of the character in
 *             ZH_READINGS (sandhi allowed): a word could fix it;
 *   neutral   the transcript has the neutral tone of a reading;
 *   other     the transcript reading is not a reading of the character
 *             (`什 shen3`, `这 zhei4`): no lexicon of readings can fix it.
 */
import { readFileSync } from 'node:fs';
import {
  heldOut,
  parseAishellLine,
  sameReading,
} from '../scripts/lexicon-metrics.mjs';
import { aishellLetter } from '../scripts/lexicon-zh.mjs';
import {
  unihanReadings,
  unihanReadingsText,
} from '../scripts/lexicon-sources.mjs';
import { hanziToPinyin } from '../src/g2p/chinese.js';

const [content, unihan] = process.argv.slice(2);
const readings = unihanReadings(unihanReadingsText(unihan));
const lines = heldOut(
  readFileSync(content, 'utf8').split('\n').filter(Boolean)
);
const classes = { reading: 0, neutral: 0, other: 0 };
const examples = { reading: new Map(), neutral: new Map(), other: new Map() };
for (const line of lines) {
  const parsed = parseAishellLine(line);
  if (!parsed || parsed.chars.some((char) => [...char].length !== 1)) {
    continue;
  }
  const items = hanziToPinyin(parsed.chars.join(''));
  parsed.chars.forEach((char, index) => {
    const ours = items[index]?.erhua ? 'er5' : items[index]?.pinyin;
    const theirs = parsed.pinyin[index];
    if (sameReading(char, ours, theirs) || char === '儿') {
      return;
    }
    const letter = readings.has(char)
      ? aishellLetter(char, readings.get(char), theirs)
      : null;
    const kind = !letter
      ? 'other'
      : /[A-Z]/.test(letter)
        ? 'neutral'
        : 'reading';
    classes[kind]++;
    const key = `${char} ${ours}→${theirs}`;
    examples[kind].set(key, (examples[kind].get(key) ?? 0) + 1);
  });
}
console.log(classes);
for (const [kind, map] of Object.entries(examples)) {
  const top = [...map].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log(`${kind}: ${top.map(([k, n]) => `${k} ${n}`).join(', ')}`);
}
