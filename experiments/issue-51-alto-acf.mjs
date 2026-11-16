// Issue 51: autocorrelation scores of the alto [aː] around one and two
// periods (octave error of estimatePitch in tests/head-presets.test.js).
// Usage: node experiments/issue-51-alto-acf.mjs [preset]
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { presetHeadConfig } from '../src/head-config.js';

const RATE = 16000;
const head = presetHeadConfig(process.argv[2] ?? 'alto');
const plan = planUtterance('ˈaː', { head });
const samples = renderPlan(plan, { sampleRate: RATE });
const v = plan.segments.find((s) => s.kind === 'vowel');
const start = Math.floor(((v.start + v.end) / 2 - 0.03) * RATE);
const length = Math.floor(0.06 * RATE);
let energy = 0;
for (let i = start; i < start + length; i++) energy += samples[i] ** 2;
const score = (lag) => {
  let sum = 0;
  for (let i = start; i < start + length; i++) sum += samples[i] * (samples[i + lag] ?? 0);
  return sum / energy;
};
const ranked = [];
for (let lag = 32; lag <= 320; lag++) ranked.push([lag, score(lag)]);
ranked.sort((a, b) => b[1] - a[1]);
console.log(head.pitch, ranked.slice(0, 6).map(([l, s]) => `${l}:${s.toFixed(3)}(${(RATE / l).toFixed(1)}Hz)`).join(' '));
