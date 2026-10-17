// Issue 5: the 3D FDTD enclosure (a box of air around the head). Prints
// level, peak and decay of a short vowel for several wall absorptions.
// Usage: node experiments/issue-5-enclosure.mjs [dx] [width height depth]
import { planUtterance, renderPlan } from '../src/index.js';

const [dx = 1, width = 30, height = 40, depth = 30] = process.argv
  .slice(2)
  .map(Number);
const sampleRate = 24000;
const plan = planUtterance('ɑ', { language: 'ipa' });

function level(samples, from, to) {
  let energy = 0;
  for (let index = from; index < to; index++) {
    energy += samples[index] ** 2;
  }
  return Math.sqrt(energy / Math.max(1, to - from));
}

const end = Math.ceil(plan.duration * sampleRate);
const free = renderPlan(plan, {
  sampleRate,
  solver: 'fdtd3d',
  dx,
  microphone: { distance: 3 },
});
console.log(
  'free field (mic 3 cm)'.padEnd(26),
  `rms ${level(free, 0, end).toExponential(3)}`
);
for (const absorption of [1, 0.5, 0.2, 0.05]) {
  const started = globalThis.performance.now();
  const samples = renderPlan(plan, {
    sampleRate,
    solver: 'fdtd3d',
    dx,
    enclosure: { width, height, depth, absorption },
  });
  const seconds = (globalThis.performance.now() - started) / 1000;
  const tail = level(samples, end, samples.length);
  const late = level(samples, end - 1200, end);
  console.log(
    `absorption ${absorption}`.padEnd(26),
    `rms ${level(samples, 0, end).toExponential(3)}`,
    `last 50 ms ${late.toExponential(3)}`,
    `tail ${tail.toExponential(3)} (${samples.length - end} samples)`,
    `finite ${samples.every(Number.isFinite)}`,
    `${seconds.toFixed(1)} s`
  );
}
