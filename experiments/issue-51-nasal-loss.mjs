// Issue 51: RMS of the [m] of aˈma for nasalLoss min/default/max
// (tests/head-parameters.test.js "lowers the nasal murmur"), and its f0.
// Usage: node experiments/issue-51-nasal-loss.mjs [ipa ...]
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { HEAD_PARAMETERS, normalizeHeadConfig } from '../src/head-config.js';

const RATE = 16000;
const parameter = HEAD_PARAMETERS.find((entry) => entry.key === 'nasalLoss');
for (const ipa of process.argv.slice(2).length ? process.argv.slice(2) : ['aˈma', 'aˈma.', 'a˥ma˥']) {
  const levels = [parameter.min, parameter.default, parameter.max].map((nasalLoss) => {
    const plan = planUtterance(ipa, { head: normalizeHeadConfig({ nasalLoss }) });
    const samples = renderPlan(plan, { sampleRate: RATE, seed: 3 });
    const nasal = plan.segments.find((item) => item.kind === 'consonant');
    const f0 = plan.channels.f0[Math.round(((nasal.start + nasal.end) / 2) * plan.frameRate)];
    return { level: rms(samples, Math.floor(nasal.start * RATE), Math.floor(nasal.end * RATE)), f0 };
  });
  console.log(
    JSON.stringify(ipa),
    'levels', levels.map((l) => l.level.toFixed(4)).join(' '),
    'default/min', (levels[1].level / levels[0].level).toFixed(3),
    'max/default', (levels[2].level / levels[1].level).toFixed(3),
    'f0 at [m]', levels[1].f0.toFixed(1)
  );
}
