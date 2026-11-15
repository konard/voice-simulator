/**
 * Acceptance checks of issue 38 against another checkout (e.g. main):
 *
 * - the audit sentence of experiments/issue-11-audit.mjs on every tier up
 *   to `ultra` (as in its real-time-factor section): RMS level in dB and
 *   duration;
 * - the time of 100 `planUtterance()` calls on its IPA.
 *
 *   git worktree add /tmp/main-wt main
 *   node experiments/issue-38-audit-compare.mjs /tmp/main-wt > before.txt
 *   node experiments/issue-38-audit-compare.mjs . > after.txt
 *
 * The root is relative to this folder's parent.
 */
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', process.argv[2] ?? '.');
const { synthesize, textToIpa, planUtterance, AUDIO_TIERS } = await import(
  pathToFileURL(path.join(root, 'src/index.js')).href
);

const sentence = 'The quick brown fox jumps over the lazy dog.';
const rmsDb = (samples) => {
  let sum = 0;
  for (const value of samples) {
    sum += value * value;
  }
  return 10 * Math.log10(sum / samples.length);
};

const { ipa } = textToIpa(sentence);
console.log(`root: ${root}`);
console.log(`ipa: ${ipa}`);
for (let warm = 0; warm < 20; warm++) {
  planUtterance(ipa, {});
}
const times = [];
for (let repeat = 0; repeat < 5; repeat++) {
  const started = performance.now();
  for (let run = 0; run < 100; run++) {
    planUtterance(ipa, {});
  }
  times.push(performance.now() - started);
}
times.sort((a, b) => a - b);
console.log(
  `planUtterance x100: median ${times[2].toFixed(1)} ms of ${times.map((t) => t.toFixed(0)).join(' ')}`
);
for (const tier of AUDIO_TIERS.slice(0, 5)) {
  const out = synthesize(sentence, { tier: tier.name, seed: 1 });
  console.log(
    `${tier.name.padEnd(8)} level ${rmsDb(out.samples).toFixed(2)} dB  duration ${out.duration.toFixed(3)} s`
  );
}
