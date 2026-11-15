/**
 * Speed of planUtterance() against another checkout (issue 38 asks for at
 * most 20 % slower over 100 runs). Both versions load into this process
 * and alternate, 100 runs of the audit sentence per round, so that noise
 * of the machine hits both alike.
 *
 *   git worktree add /tmp/main-wt main
 *   node experiments/issue-38-plan-speed.mjs /tmp/main-wt [rounds]
 */
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (root) =>
  import(pathToFileURL(path.resolve(here, '..', root, 'src/index.js')).href);
const base = await load(process.argv[2] ?? '.');
const ours = await load('.');
const rounds = Number(process.argv[3]) || 30;
const { ipa } = ours.textToIpa('The quick brown fox jumps over the lazy dog.');

const time = (api) => {
  const started = performance.now();
  for (let run = 0; run < 100; run++) {
    api.planUtterance(ipa, {});
  }
  return performance.now() - started;
};
for (let warm = 0; warm < 3; warm++) {
  time(base);
  time(ours);
}
const before = [];
const after = [];
for (let round = 0; round < rounds; round++) {
  before.push(time(base));
  after.push(time(ours));
}
const median = (values) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
};
const ratios = before.map((value, round) => after[round] / value);
console.log(`rounds of 100 plans: ${rounds}`);
console.log(`base median: ${median(before).toFixed(1)} ms`);
console.log(`this median: ${median(after).toFixed(1)} ms`);
console.log(
  `ratio of the medians: ${(median(after) / median(before)).toFixed(3)}`
);
console.log(`median ratio per round: ${median(ratios).toFixed(3)}`);
