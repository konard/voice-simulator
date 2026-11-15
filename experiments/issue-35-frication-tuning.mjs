// Level of the consonant of aCa against the vowel (dB, RMS over the middle
// 60 % of each segment) and absolute [s] level, for tuning FRICATION_GAIN
// (issue 35). Run it on this tree and on a checkout of the code before the
// change to compare:
//   node experiments/issue-35-frication-tuning.mjs [root] [ipa...]
// `root` is the repository root to load the code from (default: this one).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const root =
  args[0] && !args[0].startsWith('ˈ')
    ? path.resolve(args.shift())
    : path.resolve(import.meta.dirname, '..');
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { planUtterance } = await load('src/articulation/plan.js');
const { renderPlan } = await load('src/acoustics/voice.js');
const { rms } = await load('src/acoustics/analysis.js');

const RATE = 48000;
const decibels = (value) => 20 * Math.log10(value);

function middle(samples, segment, share = 0.6) {
  const span = segment.end - segment.start;
  const start = segment.start + (span * (1 - share)) / 2;
  return rms(
    samples,
    Math.floor(start * RATE),
    Math.floor((start + span * share) * RATE)
  );
}

const words = args.length
  ? args
  : ['ˈasa', 'ˈaʃa', 'ˈafa', 'ˈaθa', 'ˈaxa', 'ˈaza', 'ˈava', 'ˈaha'];
for (const ipa of words) {
  const plan = planUtterance(ipa, { language: 'en' });
  const samples = renderPlan(plan, { sampleRate: RATE, seed: 1 });
  const consonant = plan.segments.find((item) => item.kind === 'consonant');
  const vowel = plan.segments.find((item) => item.kind === 'vowel');
  const level = middle(samples, consonant);
  console.log(
    `${ipa.padEnd(6)} consonant ${decibels(level).toFixed(2)} dB, ` +
      `against the vowel ${decibels(level / middle(samples, vowel)).toFixed(2)} dB`
  );
}
