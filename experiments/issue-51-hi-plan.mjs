// Issue 51: what of the plan of "Hi." (the narrow-band hash text) changes.
// Prints the IPA, the segment times and f0 every 50 ms; run it in a checkout
// of main and of the branch and compare.
// Usage: node experiments/issue-51-hi-plan.mjs
import { textToIpa } from '../src/g2p/index.js';
import { planUtterance } from '../src/articulation/plan.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const { ipa } = textToIpa('Hi.', { lang: 'en' });
const plan = planUtterance(ipa, { head: normalizeHeadConfig({}), language: 'en' });
console.log(`ipa ${ipa}`);
console.log(plan.segments.map((s) => `${s.kind}:${s.token?.symbol ?? ''} ${s.start.toFixed(3)}-${s.end.toFixed(3)}`).join(' | '));
const f0 = [];
for (let frame = 0; frame < plan.frameCount; frame += Math.round(plan.frameRate * 0.05)) {
  f0.push(plan.channels.f0[frame].toFixed(1));
}
console.log(`f0 ${f0.join(' ')}`);
