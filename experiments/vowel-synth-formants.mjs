// Synthesize sustained vowels and compare LPC formants with the
// chain-matrix formants of the same tract shape.
import { planUtterance } from '../src/articulation/plan.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { estimateFormants, estimatePitch } from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const sections = Number(process.argv[2] ?? 44);
for (const symbol of ['i', 'e', 'a', 'ɑ', 'o', 'u', 'ə']) {
  const plan = planUtterance(`ˈ${symbol}ː`);
  const samples = renderPlan(plan, { sampleRate: 48000, sections });
  const vowel = plan.segments.find((s) => s.kind === 'vowel');
  const middle = (vowel.start + vowel.end) / 2;
  const lpc = estimateFormants(samples, 48000, {
    start: middle - 0.03,
    duration: 0.06,
    count: 3,
  });
  const pitch = estimatePitch(samples, 48000, { start: middle - 0.03 });
  const shape = tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
  const tube = tubeFormants(shape.areas, shape.length, { count: 3 });
  console.log(
    symbol,
    'lpc',
    lpc.map(Math.round).join(' ').padEnd(16),
    'tube',
    tube.map(Math.round).join(' ').padEnd(16),
    'f0',
    pitch.toFixed(1)
  );
}
