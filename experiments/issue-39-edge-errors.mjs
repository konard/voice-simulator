/**
 * Issue 39: where do the largest duration errors sit? Reads the
 * measurements of experiments/issue-11-fit-durations.mjs and prints the
 * error of today's plan per position: first sound, last sound, next to a
 * pause, elsewhere.
 * Run: node experiments/issue-39-edge-errors.mjs [reference]
 */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { parseIpa } from '../src/ipa/parse.js';

const reference = process.argv[2] ?? 'uniform';
const items = JSON.parse(
  readFileSync(
    process.argv[3] ?? new URL('./issue-11-fit-durations.json', import.meta.url)
  )
).items;
const groups = {};
for (const item of items) {
  const { tokens } = parseIpa(item.ipa);
  const sounds = tokens
    .map((token, index) => (token.kind === 'pause' ? -1 : index))
    .filter((index) => index >= 0);
  for (const index of sounds) {
    const measured = item.measured[reference][index];
    if (measured === null) {
      continue;
    }
    const pause = (at) =>
      tokens[at]?.kind === 'pause' && tokens[at].strength >= 1;
    const where =
      index === sounds[0]
        ? 'first'
        : index === sounds.at(-1)
          ? 'last'
          : pause(index - 1) || pause(index + 1)
            ? 'pause'
            : 'inside';
    const key = `${item.lang} ${where}`;
    (groups[key] ??= []).push(measured);
  }
}
for (const [key, values] of Object.entries(groups).sort()) {
  values.sort((a, b) => a - b);
  const mid = values[Math.floor(values.length / 2)];
  console.log(
    `${key.padEnd(10)} n ${String(values.length).padStart(3)}  median ${(mid * 1000).toFixed(0).padStart(4)} ms  max ${(values.at(-1) * 1000).toFixed(0)} ms`
  );
}

// The noise floor: the MAE of the best constant duration (the median)
// against each alignment. A model is only useful below it.
console.log('\nMAE (ms) of the best constant duration per language:');
for (const name of ['today', 'model', 'uniform', 'consensus']) {
  const values = {};
  for (const item of items) {
    const { tokens } = parseIpa(item.ipa);
    tokens.forEach((token, index) => {
      const all = ['today', 'model', 'uniform'].map(
        (plan) => item.measured[plan][index]
      );
      const measured =
        name !== 'consensus'
          ? item.measured[name][index]
          : all.includes(null)
            ? null
            : [...all].sort((x, y) => x - y)[1];
      if (token.kind !== 'pause' && measured !== null) {
        (values[item.lang] ??= []).push(measured);
      }
    });
  }
  const line = Object.entries(values).map(([lang, list]) => {
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    const mae =
      list.reduce((sum, v) => sum + Math.abs(v - mid), 0) / list.length;
    return `${lang} ${(mae * 1000).toFixed(1)}`;
  });
  console.log(`  ${name.padEnd(8)} ${line.join('  ')}`);
}
