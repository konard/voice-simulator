/**
 * Issue 41: f0 and F1-F3 of [a] for the voice type presets (mid-size head,
 * waveguide at 16 kHz, LPC order 14), as tests/head-presets.test.js
 * ("orders the voice types") measures them.
 *
 *   node experiments/issue-41-voice-types.mjs
 */

import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { estimateFormants, estimatePitch } from '../src/acoustics/analysis.js';
import { presetHeadConfig } from '../src/head-config.js';

const RATE = 16000;
const NAMES = [
  'soprano',
  'mezzo',
  'alto',
  'tenor',
  'baritone',
  'bass',
  'child5',
  'child',
  'teenFemale',
  'teenMale',
  'elderlyFemale',
  'elderlyMale',
];

for (const name of NAMES) {
  const head = presetHeadConfig(name);
  const plan = planUtterance('ˈaː', { head });
  const samples = renderPlan(plan, { sampleRate: RATE });
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  const start = (segment.start + segment.end) / 2 - 0.03;
  const f0 = estimatePitch(samples, RATE, { start, duration: 0.06 });
  const formants = estimateFormants(samples, RATE, {
    start,
    duration: 0.06,
    count: 3,
    order: 14,
  });
  console.log(
    `${name.padEnd(14)} vtl ${head.vocalTractLength.toFixed(1)} f0 ${f0.toFixed(0)} F ${formants.map((value) => value.toFixed(0)).join('/')}`
  );
}
