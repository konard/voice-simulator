// Measure f0 and formants of the male, female and child presets.
// Usage: node experiments/issue-5-presets.mjs [seeds]
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { estimateFormants, estimatePitch } from '../src/acoustics/analysis.js';
import { presetHeadConfig, randomHeadConfig } from '../src/head-config.js';

const RATE = 16000;
const seeds = Number(process.argv[2] ?? 6);

function measure(head, vowel) {
  const plan = planUtterance(`ˈ${vowel}ː`, { head });
  const samples = renderPlan(plan, { sampleRate: RATE });
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  const start = (segment.start + segment.end) / 2 - 0.03;
  return {
    f0: estimatePitch(samples, RATE, { start, duration: 0.06 }),
    formants: estimateFormants(samples, RATE, {
      start,
      duration: 0.06,
      count: 3,
    }),
  };
}

for (const preset of ['male', 'female', 'child']) {
  for (const vowel of ['ɑ', 'i', 'ə']) {
    const typical = measure(presetHeadConfig(preset), vowel);
    console.log(
      preset,
      vowel,
      'typical f0',
      typical.f0.toFixed(0),
      'F',
      typical.formants.map((value) => value.toFixed(0)).join('/')
    );
  }
  const f0s = [];
  for (let seed = 0; seed < seeds; seed++) {
    f0s.push(measure(randomHeadConfig(seed, { preset }), 'ə').f0);
  }
  console.log(
    preset,
    'random f0',
    f0s.map((value) => value.toFixed(0))
  );
}
