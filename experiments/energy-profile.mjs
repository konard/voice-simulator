// RMS profile in 5 ms steps with key channels, to inspect transitions.
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';

const ipa = process.argv[2] ?? 'ˈata';
const rate = 48000;
const plan = planUtterance(ipa, { language: 'en' });
const samples = renderPlan(plan, { sampleRate: rate });
for (let t = 0.1; t < plan.duration - 0.1; t += 0.005) {
  const state = sampleState(plan, t);
  const shape = tractShape(state, plan.head);
  const minArea = Math.min(...shape.areas.slice(8));
  console.log(
    t.toFixed(3),
    (rms(samples, Math.floor(t * rate), Math.floor((t + 0.005) * rate)) * 100)
      .toFixed(1)
      .padStart(5),
    'min',
    minArea.toFixed(3),
    'fric',
    shape.frication.gain.toFixed(2),
    'voice',
    state.voicing.toFixed(2),
    'asp',
    state.aspiration.toFixed(2)
  );
}
