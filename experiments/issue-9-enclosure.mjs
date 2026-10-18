// Late energy after /ɑ/ in a small enclosure with soft and hard walls (3D FDTD).
// Usage: node experiments/issue-9-enclosure.mjs
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { planUtterance } from '../src/articulation/plan.js';

const RATE = 16000;
const box = { width: 14, height: 12, depth: 12, center: [0, -5.5, 8] };
const plan = planUtterance('ɑ', { language: 'ipa' });
const vowelSamples = Math.ceil(plan.duration * RATE);
for (const absorption of [1, 0.05]) {
  const samples = renderPlan(plan, {
    sampleRate: RATE,
    solver: 'fdtd3d',
    dx: 1,
    enclosure: { ...box, absorption },
  });
  const parts = [];
  for (let start = vowelSamples - 800; start < samples.length; start += 400) {
    parts.push(rms(samples.subarray(start, start + 400)).toExponential(1));
  }
  console.log(
    `absorption ${absorption} length ${samples.length} (vowel ${vowelSamples}):`,
    parts.join(' ')
  );
}
