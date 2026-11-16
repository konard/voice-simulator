// Issue 51: mean vowel f0 of ˈmi and ˈma over the whole vowel and its first
// half, with and without intrinsicPitch (tests/articulators.test.js).
// Usage: node experiments/issue-51-mi-ma.mjs
import { planUtterance } from '../src/articulation/plan.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';

function mean(ipa, head, part) {
  const plan = planUtterance(ipa, { head });
  const v = plan.segments.find((s) => s.kind === 'vowel');
  const end = (v.start + (v.end - v.start) * part) * plan.frameRate;
  let sum = 0;
  let count = 0;
  for (let i = Math.ceil(v.start * plan.frameRate); i < end; i++) {
    sum += plan.channels.f0[i];
    count++;
  }
  return sum / count;
}
for (const part of [1, 0.5]) {
  for (const [name, head] of [
    ['default', DEFAULT_HEAD],
    ['intrinsic 2', normalizeHeadConfig({ intrinsicPitch: 2 })],
  ]) {
    const st = 12 * Math.log2(mean('ˈmi', head, part) / mean('ˈma', head, part));
    console.log(`part ${part} ${name}: mi - ma = ${st.toFixed(3)} st`);
  }
}
