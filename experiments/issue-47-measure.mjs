#!/usr/bin/env node
/**
 * Issue 47: the three lexicon numbers of the pull request.
 *
 *   node experiments/issue-47-measure.mjs [--aishell <content.txt>]
 *
 * English and Hindi: share of running words of the FLEURS validation text
 * (fleurs-en, fleurs-hi of datasets/registry.json, fetched with
 * `node scripts/datasets.mjs fetch <id>`) whose source is not `rules`.
 * Chinese: syllables of every tenth line of AISHELL-3 train/content.txt
 * (aishell3-train-index) that hanziToPinyin reads as the transcript does.
 */
import { existsSync, readFileSync } from 'node:fs';
import { readDataset } from '../scripts/datasets.mjs';
import {
  aishellAccuracy,
  coverage,
  heldOut,
} from '../scripts/lexicon-metrics.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--aishell');
const aishell =
  at >= 0 ? args[at + 1] : '.datasets/aishell3-train-index/content.txt';

for (const [lang, id] of [
  ['en', 'fleurs-en'],
  ['hi', 'fleurs-hi'],
]) {
  const lines = readDataset(id).map((row) => row.text);
  if (lines.length === 0) {
    console.log(`${id}: not fetched`);
    continue;
  }
  const result = coverage(lang, lines, { missing: 20 });
  console.log(
    `${id}: ${lines.length} lines, ${result.words} words, ${(100 * result.share).toFixed(2)} % not from rules`
  );
  console.log(
    `  missing: ${result.missing.map(([w, n]) => `${w} ${n}`).join(', ')}`
  );
}
if (existsSync(aishell)) {
  const lines = heldOut(
    readFileSync(aishell, 'utf8').split('\n').filter(Boolean)
  );
  const result = aishellAccuracy(lines, { errors: 40 });
  console.log(
    `aishell held-out: ${lines.length} lines, ${result.syllables} syllables, ${result.errors} errors, ${(100 * result.share).toFixed(2)} % read as written`
  );
  console.log(
    `  misread: ${result.misread.map(([w, n]) => `${w} ${n}`).join(', ')}`
  );
} else {
  console.log(`${aishell}: not found`);
}
