// Formants of the male and female presets with the teeth and piriform
// fossae switched on and off (checks the head-presets F2 ratio).
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { estimateFormants, estimatePitch } from '../src/acoustics/analysis.js';
import { presetHeadConfig } from '../src/head-config.js';

const RATE = 16000;
function measure(head, vowel, options) {
  const plan = planUtterance(`ˈ${vowel}ː`, { head });
  const samples = renderPlan(plan, { sampleRate: RATE, ...options });
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  const start = (segment.start + segment.end) / 2 - 0.03;
  return {
    f0: Math.round(estimatePitch(samples, RATE, { start, duration: 0.06 })),
    formants: estimateFormants(samples, RATE, {
      start,
      duration: 0.06,
      count: 3,
    }).map(Math.round),
  };
}
for (const options of [
  {},
  { piriform: false },
  { teeth: false },
  { piriform: false, teeth: false },
]) {
  for (const vowel of ['i', 'ə']) {
    const female = measure(presetHeadConfig('female'), vowel, options);
    const male = measure(presetHeadConfig('male'), vowel, options);
    console.log(
      JSON.stringify(options),
      vowel,
      'female',
      female.formants.join(' '),
      'male',
      male.formants.join(' '),
      'F2 ratio',
      (female.formants[1] / male.formants[1]).toFixed(2)
    );
  }
}
