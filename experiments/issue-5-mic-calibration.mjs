// Issue 5: level of the 3D FDTD microphone (spherical boundary) against the
// waveguide with the same microphone, to calibrate the 3D microphone gain.
// Usage: node experiments/issue-5-mic-calibration.mjs [dx...]
import { planUtterance, renderPlan } from '../src/index.js';

const sampleRate = 24000;
const dxs = process.argv.slice(2).map(Number);

function rms(samples) {
  let energy = 0;
  for (const value of samples) {
    energy += value * value;
  }
  return Math.sqrt(energy / samples.length);
}

for (const dx of dxs.length > 0 ? dxs : [1, 0.6]) {
  for (const distance of [3, 10]) {
    const ratios = [];
    for (const ipa of ['ɑ', 'i', 'u', 'ma', 'sa']) {
      const plan = planUtterance(ipa, { language: 'ipa' });
      const microphone = { distance };
      const reference = rms(renderPlan(plan, { sampleRate, microphone }));
      const level = rms(
        renderPlan(plan, { sampleRate, microphone, solver: 'fdtd3d', dx })
      );
      ratios.push(level / reference);
    }
    const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
    console.log(
      `dx ${dx} mic ${distance} cm`,
      ratios.map((value) => value.toFixed(3)).join(' '),
      `mean ${mean.toFixed(3)}`
    );
  }
}
