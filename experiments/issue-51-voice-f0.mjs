// Issue 51: f0 of the rendered [aː] of the singer presets, estimated in
// 60 ms at the middle of the vowel (tests/head-presets.test.js), and the
// planned f0 there.
// Usage: node experiments/issue-51-voice-f0.mjs
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { estimatePitch } from '../src/acoustics/analysis.js';
import { presetHeadConfig } from '../src/head-config.js';

const RATE = 16000;
for (const name of ['soprano', 'mezzo', 'alto', 'tenor', 'baritone', 'bass']) {
  const head = presetHeadConfig(name);
  const plan = planUtterance('ˈaː', { head });
  const samples = renderPlan(plan, { sampleRate: RATE });
  const v = plan.segments.find((s) => s.kind === 'vowel');
  const start = (v.start + v.end) / 2 - 0.03;
  const f0 = estimatePitch(samples, RATE, { start, duration: 0.06 });
  const planned = [];
  for (let t = start; t <= start + 0.06; t += 0.02) planned.push(plan.channels.f0[Math.round(t * plan.frameRate)].toFixed(1));
  console.log(name, head.pitch, f0.toFixed(2), planned.join(' '));
}
