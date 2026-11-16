#!/usr/bin/env node
/**
 * Issue 47: every fleurs-en word read by the letter rules, and whether the
 * full CMUdict (--full JSON, if given) knows it.
 *
 *   node experiments/issue-47-en-missing.mjs [en-full.json]
 */
import { readFileSync } from 'node:fs';
import { readDataset } from '../scripts/datasets.mjs';
import { coverage } from '../scripts/lexicon-metrics.mjs';

const full = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8')).words
  : {};
const lines = readDataset('fleurs-en').map((row) => row.text);
const result = coverage('en', lines, { missing: 1000 });
console.log(`${result.words} words, ${result.known} known`);
for (const [word, count] of result.missing) {
  console.log(`${word} ${count} ${full[word] ? full[word].join('/') : '-'}`);
}
