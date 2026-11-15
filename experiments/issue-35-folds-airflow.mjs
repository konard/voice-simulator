// Consonant and vowel levels (dB, RMS over the middle 60 % of each
// segment) of aCa with the fold source and with the LF source (issue 35:
// with `source: 'folds'` the air flow takes the mean area of the folds and
// the breath noise of the folds the turbulence source strength). Run it on
// this tree and on a checkout of the code before the change to compare:
//   node experiments/issue-35-folds-airflow.mjs [root]
// `root` is the repository root to load the code from (default: this one).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, '..')
);
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { planUtterance } = await load('src/articulation/plan.js');
const { renderPlan } = await load('src/acoustics/voice.js');
const { rms } = await load('src/acoustics/analysis.js');

const RATE = 48000;
const decibels = (value) => (20 * Math.log10(value)).toFixed(2);

function middle(samples, segment, share = 0.6) {
  const span = segment.end - segment.start;
  const start = segment.start + (span * (1 - share)) / 2;
  return rms(
    samples,
    Math.floor(start * RATE),
    Math.floor((start + span * share) * RATE)
  );
}

for (const source of ['lf', 'folds']) {
  for (const ipa of ['ˈasa', 'ˈaza', 'ˈafa', 'ˈaha', 'ˈapʰa', 'ˈama']) {
    const plan = planUtterance(ipa, { language: 'en' });
    const samples = renderPlan(plan, { sampleRate: RATE, seed: 1, source });
    const consonant = plan.segments.find((item) => item.kind === 'consonant');
    const vowel = plan.segments.find((item) => item.kind === 'vowel');
    console.log(
      `${source.padEnd(5)} ${ipa.padEnd(6)} consonant ` +
        `${decibels(middle(samples, consonant))} dB, vowel ` +
        `${decibels(middle(samples, vowel))} dB`
    );
  }
}
