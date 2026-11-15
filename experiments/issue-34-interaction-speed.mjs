/**
 * Render time of the audit sentence (experiments/issue-11-audit.mjs) on
 * tier medium with the LF source and with the fold source plus the
 * source-tract interaction (issue 34, checklist item b: at most 35 %
 * slower than LF): median of 5 runs each, alternating, after one warm-up
 * run of each. The plain fold source is timed too for reference.
 *
 *   node experiments/issue-34-interaction-speed.mjs
 */
import { synthesize } from '../src/index.js';

const SENTENCE = 'The quick brown fox jumps over the lazy dog.';
const RUNS = 5;
const SETUPS = {
  lf: { source: 'lf' },
  folds: { source: 'folds' },
  interaction: { source: 'folds', interaction: true },
};

function time(options) {
  const started = globalThis.performance.now();
  const out = synthesize(SENTENCE, { tier: 'medium', seed: 1, ...options });
  return { ms: globalThis.performance.now() - started, duration: out.duration };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const names = Object.keys(SETUPS);
const first = names.map((name) => time(SETUPS[name]));
const runs = Object.fromEntries(names.map((name) => [name, []]));
for (let run = 0; run < RUNS; run++) {
  for (const name of names) {
    runs[name].push(time(SETUPS[name]).ms);
  }
}
console.log(`audio duration        ${first[0].duration.toFixed(2)} s`);
for (const name of names) {
  console.log(
    `${`${name} runs (ms)`.padEnd(22)}${runs[name].map((v) => v.toFixed(0)).join(' ')}`
  );
}
const lf = median(runs.lf);
for (const name of names) {
  console.log(
    `${`median ${name}`.padEnd(22)}${median(runs[name]).toFixed(0)} ms`
  );
}
console.log(`folds / lf            ${(median(runs.folds) / lf).toFixed(3)}`);
console.log(
  `interaction / lf      ${(median(runs.interaction) / lf).toFixed(3)}`
);
