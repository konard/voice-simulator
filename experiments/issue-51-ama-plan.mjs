// Issue 51: segments and the f0 every 20 ms of aˈma (nasal murmur test).
// Usage: node experiments/issue-51-ama-plan.mjs [ipa]
import { planUtterance } from '../src/articulation/plan.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const plan = planUtterance(process.argv[2] ?? 'aˈma', { head: normalizeHeadConfig({}) });
for (const s of plan.segments) {
  const f0 = [];
  for (let t = s.start; t < s.end; t += 0.02) f0.push(plan.channels.f0[Math.round(t * plan.frameRate)].toFixed(0));
  console.log(s.kind, s.token?.symbol ?? '', (s.start * 1000).toFixed(0), (s.end * 1000).toFixed(0), f0.join(' '));
}
