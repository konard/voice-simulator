// Sibilant high-frequency energy with and without the incisors.
// Usage: [DX=1] [RATE=16000] node experiments/issue-5-teeth-sibilance.mjs [solver]
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { Biquad } from '../src/acoustics/filters.js';
import { planUtterance } from '../src/articulation/plan.js';

const solver = process.argv[2] ?? 'waveguide';
const RATE = Number(process.env.RATE ?? (solver === 'fdtd3d' ? 16000 : 32000));
const DX = Number(process.env.DX ?? 1);

function highpass(samples, cutoff, rate) {
  const filters = [new Biquad(), new Biquad()];
  filters[0].highpass(cutoff, 0.54, rate);
  filters[1].highpass(cutoff, 1.31, rate);
  return Float32Array.from(samples, (value) =>
    filters[1].process(filters[0].process(value))
  );
}

for (const text of ['ˈasa', 'ˈaʃa', 'ˈaza', 'ˈafa']) {
  const plan = planUtterance(text);
  const segment = plan.segments.find((entry) => entry.kind === 'consonant');
  const start = Math.round(segment.start * RATE);
  const end = Math.round(segment.end * RATE);
  const row = [text];
  for (const teeth of [true, false]) {
    const samples = renderPlan(plan, {
      sampleRate: RATE,
      solver,
      teeth,
      dx: DX,
    });
    const high = highpass(samples, 4000, RATE);
    row.push(
      teeth ? 'teeth' : 'none',
      'all',
      rms(samples, start, end).toFixed(4),
      'hf',
      rms(high, start, end).toFixed(4),
      'ratio',
      (rms(high, start, end) / rms(samples, start, end)).toFixed(3)
    );
  }
  console.log(row.join(' '));
}
