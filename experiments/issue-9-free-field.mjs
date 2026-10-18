/**
 * Level of the 3D FDTD voice at several microphone distances, to see how
 * close the free field around the head follows 1/r.
 * Usage: node experiments/issue-9-free-field.mjs [dx]
 */
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/index.js';

const RATE = 16000;
const dx = Number(process.argv[2] ?? 1);
const plan = planUtterance('ɑ', { language: 'ipa' });
const rms = (samples) =>
  Math.sqrt(
    samples.reduce((sum, value) => sum + value * value, 0) / samples.length
  );
const levels = {};
for (const distance of [3, 5, 8]) {
  const out = renderPlan(plan, {
    sampleRate: RATE,
    solver: 'fdtd3d',
    dx,
    microphone: { distance },
  });
  levels[distance] = rms(out.subarray(0, Math.ceil(plan.duration * RATE)));
}
console.log(
  JSON.stringify(levels),
  'ratio 3/8',
  (levels[3] / levels[8]).toFixed(3)
);
