/**
 * High-frequency (4–10 kHz) level of sibilants with and without teeth.
 * Args: [solver]
 */
import { rms } from '../src/acoustics/analysis.js';
import { Biquad } from '../src/acoustics/filters.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { planUtterance } from '../src/articulation/plan.js';

const RATE = 32000;
const solver = process.argv[2] ?? 'waveguide';
function level(text, options) {
  const plan = planUtterance(text);
  const samples = renderPlan(plan, { sampleRate: RATE, solver, ...options });
  const filters = [new Biquad(), new Biquad()];
  filters[0].highpass(4000, 0.54, RATE);
  filters[1].highpass(4000, 1.31, RATE);
  const out = samples.map((x) => filters[1].process(filters[0].process(x)));
  const seg = plan.segments.find((s) => s.kind === 'consonant');
  return rms(out, Math.floor(seg.start * RATE), Math.floor(seg.end * RATE));
}
for (const text of ['ˈasa', 'ˈaʃa', 'ˈafa']) {
  const t = level(text, {});
  const n = level(text, { teeth: false });
  console.log(text, t.toFixed(5), n.toFixed(5), 'ratio', (t / n).toFixed(2));
}
