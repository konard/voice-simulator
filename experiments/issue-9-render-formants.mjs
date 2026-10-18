/**
 * Formants (LPC) of rendered sustained vowels against the tube model of
 * their shape, for the waveguide renderer. Args: [sections]
 */
import { planUtterance } from '../src/articulation/plan.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { estimateFormants } from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const RATE = 24000;
const sections = Number(process.argv[2] ?? 44);
for (const symbol of ['i', 'ɑ', 'ə', 'u']) {
  const plan = planUtterance(`ˈ${symbol}ː`);
  const samples = renderPlan(plan, {
    sampleRate: RATE,
    sections,
    piriform: process.env.PIRIFORM !== '0',
  });
  const v = plan.segments.find((s) => s.kind === 'vowel');
  const middle = (v.start + v.end) / 2;
  const measured = estimateFormants(samples, RATE, {
    start: middle - 0.03,
    duration: 0.06,
    count: 3,
  });
  const shape = tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
  const expected = tubeFormants(shape.areas, shape.length, { count: 3 });
  console.log(
    `/${symbol}/ rendered ${measured.map(Math.round).join(' ')} | tube ${expected.map(Math.round).join(' ')}`
  );
}
