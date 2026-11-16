// Issue 51: how the nasalLoss effect on the [m] of aˈma depends on the
// head pitch (the murmur level ratios default/min and max/default).
// Usage: node experiments/issue-51-nasal-pitch.mjs [ipa]
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { HEAD_PARAMETERS, normalizeHeadConfig } from '../src/head-config.js';

const RATE = 16000;
const ipa = process.argv[2] ?? 'aˈma';
const parameter = HEAD_PARAMETERS.find((entry) => entry.key === 'nasalLoss');
for (const pitch of [100, 110, 115, 120, 125, 130, 140, 150]) {
  const levels = [parameter.min, parameter.default, parameter.max].map((nasalLoss) => {
    const plan = planUtterance(ipa, { head: normalizeHeadConfig({ nasalLoss, pitch }) });
    const samples = renderPlan(plan, { sampleRate: RATE, seed: 3 });
    const nasal = plan.segments.find((item) => item.kind === 'consonant');
    return rms(samples, Math.floor(nasal.start * RATE), Math.floor(nasal.end * RATE));
  });
  console.log(ipa, 'pitch', pitch, 'default/min', (levels[1] / levels[0]).toFixed(3), 'max/default', (levels[2] / levels[1]).toFixed(3));
}
