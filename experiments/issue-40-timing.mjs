#!/usr/bin/env node
// Issue 40: time to render the audit sentence (issue-11-audit.mjs, part 9)
// on the tiers medium and high, best of several runs, for one checkout.
// Usage: node experiments/issue-40-timing.mjs [root of a checkout] [runs] [tiers]
//   tiers  comma-separated, default medium,high
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const runs = Number(process.argv[3] ?? 3);
const { synthesize } = await import(pathToFileURL(`${root}/src/index.js`).href);
const sentence = 'The quick brown fox jumps over the lazy dog.';
const tiers = (process.argv[4] ?? 'medium,high').split(',');
for (const tier of tiers) {
  const times = [];
  let duration = 0;
  for (let run = 0; run < runs; run++) {
    const started = performance.now();
    const out = synthesize(sentence, { tier, seed: 1 });
    times.push((performance.now() - started) / 1000);
    duration = out.duration;
  }
  const best = Math.min(...times);
  console.log(
    `${tier}: best ${best.toFixed(3)} s of ${runs} (${times.map((time) => time.toFixed(3)).join(', ')}), rtf ${(best / duration).toFixed(3)}`
  );
}
