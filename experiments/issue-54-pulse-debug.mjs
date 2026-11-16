// Prints the pulse trains (periods in ms) of a render, issue 54.
// node experiments/issue-54-pulse-debug.mjs "<text>"
import { synthesize } from '../src/index.js';
import { glottalPeriods } from '../src/analysis/mode-features.js';
const text = process.argv[2] ?? 'Please call Stella.';
const r = synthesize(text, { tier: 'medium', seed: 1, markup: true });
for (const train of glottalPeriods(r.samples, r.sampleRate)) {
  const periods = train.periods.map((t) => (t * 1000).toFixed(2));
  console.log(periods.join(' '));
}
