#!/usr/bin/env node
/**
 * Issue 48: merge parts of ru-stress.txt written for slices of
 * data/lexicon/ru-counts.txt into one list, without repeated items.
 *
 *   node experiments/issue-48-merge-parts.mjs OUT PART...
 *
 * Writes the items of all parts (stems first, then whole forms, each
 * sorted) to OUT and prints the keys (stem or form) that parts mark
 * differently, with every variant and how many parts wrote it; the first
 * variant (most parts, then first part) is written, so check these by
 * hand.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseRussianItem } from '../scripts/lexicon-ru.mjs';

const [out, ...parts] = process.argv.slice(2);
const keys = new Map();
for (const part of parts) {
  for (const raw of readFileSync(part, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/u, '').trim().normalize('NFC');
    if (!line) {
      continue;
    }
    let item;
    try {
      item = parseRussianItem(line);
    } catch (error) {
      console.log(`skipped ${part}: ${error.message}`);
      continue;
    }
    const key = item.kind === 'form' ? `=${item.word}` : item.stem;
    const variants = keys.get(key) ?? new Map();
    const variant = variants.get(item.payload) ?? { line, parts: 0 };
    variant.parts++;
    variants.set(item.payload, variant);
    keys.set(key, variants);
  }
}
const lines = [];
for (const [key, variants] of keys) {
  const sorted = [...variants.values()].sort((a, b) => b.parts - a.parts);
  if (sorted.length > 1) {
    console.log(
      `${key}: ${sorted.map((v) => `${v.line} (${v.parts})`).join(', ')}`
    );
  }
  lines.push(sorted[0].line);
}
const stems = lines.filter((line) => !line.startsWith('=')).sort();
const forms = lines.filter((line) => line.startsWith('=')).sort();
writeFileSync(out, `${[...stems, ...forms].join('\n')}\n`);
console.log(`stems: ${stems.length}, forms: ${forms.length}`);
