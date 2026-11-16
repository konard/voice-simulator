#!/usr/bin/env node
/**
 * Issue 48: list every item of data/lexicon/ru-stress.txt that repeats or
 * contradicts an earlier one (the build stops at the first).
 *
 *   node experiments/issue-48-check-items.mjs [FILE]
 */

import { readFileSync } from 'node:fs';
import { parseRussianItem } from '../scripts/lexicon-ru.mjs';

const file = process.argv[2] ?? 'data/lexicon/ru-stress.txt';
const seen = new Map();
readFileSync(file, 'utf8')
  .split('\n')
  .forEach((raw, index) => {
    const line = raw.replace(/#.*$/u, '').trim().normalize('NFC');
    if (!line) {
      return;
    }
    let item;
    try {
      item = parseRussianItem(line);
    } catch (error) {
      console.log(`${index + 1}: ${error.message}`);
      return;
    }
    const key = item.kind === 'form' ? `=${item.word}` : item.stem;
    const known = seen.get(key);
    if (known && known.payload !== item.payload) {
      console.log(`${index + 1}: ${line} contradicts ${known.line}`);
    } else if (known) {
      console.log(`${index + 1}: ${line} repeats ${known.line}`);
    } else {
      seen.set(key, { payload: item.payload, line: `${index + 1}: ${line}` });
    }
  });
