// f0 (Hz) inside the vowel of Mandarin syllables at fixed fractions of the
// vowel (issue 42). "planned" is the piecewise linear curve of fillPitch(),
// "whole" smooths that curve with the f0 time constant as a whole (the dip
// of the third tone almost vanishes), "f0" is what planUtterance() returns
// (the movement between syllables is smoothed, the tone shape is kept).
// Run: node experiments/issue-42-vowel-f0.mjs
import {
  CHANNELS,
  fillPitch,
  planUtterance,
  smoothChannel,
} from '../src/articulation/plan.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const head = normalizeHeadConfig({ vibrato: 0 });
const fractions = [0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.6, 0.75, 0.95, 1];

for (const ipa of ['ma˥', 'ma˧˥', 'ma˨˩˦', 'ma˥˩', 'ma˨˩']) {
  const plan = planUtterance(ipa, { head, language: 'zh' });
  const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
  const span = vowel.end - vowel.start;
  const planned = new Float32Array(plan.frameCount);
  fillPitch(planned, plan.segments, head, plan.frameRate);
  const whole = smoothChannel(
    Float32Array.from(planned),
    CHANNELS.f0 / head.articulationSpeed,
    plan.frameRate
  );
  const at = (values, time) =>
    values[Math.min(plan.frameCount - 1, Math.round(time * plan.frameRate))];
  const rows = { planned: [], whole: [], f0: [] };
  for (const fraction of fractions) {
    const time = vowel.start + span * fraction;
    rows.planned.push(at(planned, time));
    rows.whole.push(at(whole, time));
    rows.f0.push(sampleState(plan, time).f0);
  }
  console.log(`${ipa} (vowel ${Math.round(span * 1000)} ms)`);
  console.log(
    `  fraction ${fractions.map((v) => String(v).padStart(6)).join('')}`
  );
  for (const [name, values] of Object.entries(rows)) {
    const cells = values.map((v) => v.toFixed(1).padStart(6)).join('');
    console.log(`  ${name.padEnd(8)} ${cells}`);
  }
}
