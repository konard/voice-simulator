// Issue 5: how the 3D FDTD microphone level falls off with distance, for a
// fixed free-air shell (radius 12 cm) and for the shell chosen per distance.
// Usage: node experiments/issue-5-mic-falloff.mjs [dx]
import {
  buildVoxelModel,
  normalizeHeadConfig,
  planUtterance,
  renderPlan,
} from '../src/index.js';

const dx = Number(process.argv[2] ?? 1);
const head = normalizeHeadConfig({});
const plan = planUtterance('ɑ', { language: 'ipa' });
const sampleRate = 24000;
const shell = buildVoxelModel(head, { dx, radiationRadius: 12 });

function rms(samples) {
  let energy = 0;
  for (const value of samples) {
    energy += value * value;
  }
  return Math.sqrt(energy / samples.length);
}

const options = { sampleRate, solver: 'fdtd3d', dx, head };
let reference = null;
for (const distance of [2, 3, 4, 6, 8, 10, 11]) {
  const microphone = { distance };
  const fixed = rms(renderPlan(plan, { ...options, microphone, model: shell }));
  const own = rms(renderPlan(plan, { ...options, microphone }));
  reference ??= fixed * distance;
  console.log(
    `${distance} cm`.padEnd(6),
    `fixed shell ${fixed.toExponential(3)}`,
    `own shell ${own.toExponential(3)}`,
    `fixed * r / ref ${((fixed * distance) / reference).toFixed(3)}`
  );
}
