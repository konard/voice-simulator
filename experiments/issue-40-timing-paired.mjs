#!/usr/bin/env node
// Issue 40: render the audit sentence with two checkouts in one process,
// alternating run by run, so that load changes of the machine hit both
// alike. Prints wall and CPU (user + system) seconds per run, the median
// of each and the ratio of the second checkout to the first.
// Usage: node experiments/issue-40-timing-paired.mjs <root A> <root B> [tier] [runs]
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const roots = [resolve(process.argv[2]), resolve(process.argv[3])];
const tier = process.argv[4] ?? 'high';
const runs = Number(process.argv[5] ?? 8);
const sentence = 'The quick brown fox jumps over the lazy dog.';
const modules = [];
for (const root of roots) {
  modules.push(await import(pathToFileURL(`${root}/src/index.js`).href));
}
const wall = [[], []];
const cpu = [[], []];
for (let run = 0; run <= runs; run++) {
  for (let which = 0; which < 2; which++) {
    const order = run % 2 === 0 ? which : 1 - which;
    const started = performance.now();
    const usage = process.cpuUsage();
    modules[order].synthesize(sentence, { tier, seed: 1 });
    const spent = process.cpuUsage(usage);
    // The first round warms both up.
    if (run > 0) {
      wall[order].push((performance.now() - started) / 1000);
      cpu[order].push((spent.user + spent.system) / 1e6);
    }
  }
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const show = (values) => values.map((value) => value.toFixed(3)).join(', ');
roots.forEach((root, index) => {
  console.log(`${root}: wall ${show(wall[index])}`);
  console.log(`${root}: cpu  ${show(cpu[index])}`);
});
console.log(
  `${tier}: median wall ${median(wall[0]).toFixed(3)} / ${median(wall[1]).toFixed(3)} s (ratio ${(median(wall[1]) / median(wall[0])).toFixed(3)}), ` +
    `median cpu ${median(cpu[0]).toFixed(3)} / ${median(cpu[1]).toFixed(3)} s (ratio ${(median(cpu[1]) / median(cpu[0])).toFixed(3)})`
);
