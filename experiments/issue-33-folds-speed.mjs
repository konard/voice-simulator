/**
 * Render time of the audit sentence (experiments/issue-11-audit.mjs) on
 * tier medium with the LF source and with the fold source (issue 33):
 * median of 5 runs each, alternating, after one warm-up run of each. The
 * first fold run also fills the tension table of the head (cached).
 *
 *   node experiments/issue-33-folds-speed.mjs
 */
import { synthesize } from '../src/index.js';

const SENTENCE = 'The quick brown fox jumps over the lazy dog.';
const RUNS = 5;

function time(source) {
  const started = globalThis.performance.now();
  const out = synthesize(SENTENCE, { tier: 'medium', seed: 1, source });
  return { ms: globalThis.performance.now() - started, duration: out.duration };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const first = time('folds');
time('lf');
const runs = { lf: [], folds: [] };
for (let run = 0; run < RUNS; run++) {
  runs.lf.push(time('lf').ms);
  runs.folds.push(time('folds').ms);
}
const lf = median(runs.lf);
const folds = median(runs.folds);
console.log(`audio duration        ${first.duration.toFixed(2)} s`);
console.log(
  `first folds run       ${first.ms.toFixed(0)} ms (fills the table)`
);
console.log(
  `lf runs (ms)          ${runs.lf.map((v) => v.toFixed(0)).join(' ')}`
);
console.log(
  `folds runs (ms)       ${runs.folds.map((v) => v.toFixed(0)).join(' ')}`
);
console.log(`median lf             ${lf.toFixed(0)} ms`);
console.log(`median folds          ${folds.toFixed(0)} ms`);
console.log(`folds / lf            ${(folds / lf).toFixed(3)}`);
