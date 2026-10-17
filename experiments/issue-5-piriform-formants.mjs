// Measured vs tube formants of vowels with and without the piriform branch.
// Usage: node experiments/issue-5-piriform-formants.mjs
import { estimateFormants } from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { planUtterance } from '../src/articulation/plan.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const RATE = Number(process.env.RATE ?? 24000);

for (const symbol of ['i', 'ɑ', 'ə', 'u']) {
  const plan = planUtterance(`ˈ${symbol}ː`);
  const vowel = plan.segments.find((entry) => entry.kind === 'vowel');
  const middle = (vowel.start + vowel.end) / 2;
  const shape = tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
  const expected = tubeFormants(shape.areas, shape.length, { count: 3 });
  const row = [symbol, 'tube', expected.map(Math.round).join(' ')];
  for (const piriform of [true, false]) {
    const samples = renderPlan(plan, { sampleRate: RATE, piriform });
    const measured = estimateFormants(samples, RATE, {
      start: middle - 0.03,
      duration: 0.06,
      count: Number(process.env.COUNT ?? 2),
    });
    row.push(piriform ? 'with' : 'without', measured.map(Math.round).join(' '));
  }
  console.log(row.join(' | '));
}
