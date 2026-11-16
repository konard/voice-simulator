// Issue 49: f0 of a Mandarin third tone ma˨˩˦, frame by frame, with the
// segment boundaries. Usage: node experiments/issue-49-third-tone.mjs [ipa]
import { planUtterance } from '../src/articulation/plan.js';
import { pitchTargets } from '../src/articulation/prosody.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const ipa = process.argv[2] ?? 'ma˨˩˦';
const head = normalizeHeadConfig({ vibrato: 0 });
const plan = planUtterance(ipa, { head, language: 'zh' });
for (const segment of plan.segments) {
  console.log(
    segment.kind,
    segment.symbol ?? segment.ipa ?? '',
    segment.start.toFixed(3),
    segment.end.toFixed(3)
  );
}
const f0 = plan.channels.f0;
const step = Math.max(1, Math.round(plan.frameRate * 0.01));
for (let frame = 0; frame < f0.length; frame += step) {
  console.log((frame / plan.frameRate).toFixed(3), f0[frame].toFixed(1));
}
void pitchTargets;
