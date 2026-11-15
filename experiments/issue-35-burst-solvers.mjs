// The burst transient of a stop in each solver (issue 35, after the merge
// of the 2D sheet of issue 37): peak of the first 3 ms after the release
// against the peak of the first 20 ms rendered without the transient (the
// flow derivative set to 0), as section 2 of issue-11-turbulence.mjs.
// French plans, 48 kHz (16 kHz for fdtd3d), seed 1, blocks of 32 samples.
// Run: node experiments/issue-35-burst-solvers.mjs [solver...]
import { planUtterance } from '../src/articulation/plan.js';
import { VoiceRenderer } from '../src/acoustics/voice.js';

const BLOCK = 32;
const solvers = process.argv.slice(2);

function render(plan, solver, rate, transient) {
  const renderer = new VoiceRenderer(plan, {
    sampleRate: rate,
    seed: 1,
    solver,
    blockSize: BLOCK,
  });
  const air = renderer.aerodynamics;
  const step = air.step.bind(air);
  let area = 0;
  air.step = (dt, lung, glottis, constriction) => {
    area = constriction;
    const result = step(dt, lung, glottis, constriction);
    return transient ? result : { ...result, flowDerivative: 0 };
  };
  const samples = new Float32Array(renderer.totalSamples);
  const areas = [];
  for (let start = 0; start < samples.length; start += BLOCK) {
    renderer.render(samples.subarray(start, start + BLOCK));
    areas.push(area);
  }
  return { samples, areas };
}

function peak(samples, start, milliseconds, rate) {
  let value = 0;
  const end = start + Math.round((milliseconds / 1000) * rate);
  for (let index = start; index < end; index++) {
    value = Math.max(value, Math.abs(samples[index]));
  }
  return value;
}

console.log('solver     word  burst dB');
for (const solver of solvers.length
  ? solvers
  : ['waveguide', 'fdtd2d', 'fdtd3d']) {
  const rate = solver === 'fdtd3d' ? 16000 : 48000;
  for (const word of ['pa', 'ta', 'ka']) {
    const plan = planUtterance(`ˈ${word}`, { language: 'fr' });
    const loud = render(plan, solver, rate, true);
    const quiet = render(plan, solver, rate, false);
    const closed = loud.areas.findIndex((area) => area <= 0.001);
    const release = loud.areas.findIndex(
      (area, index) => index > closed && area > 0.001
    );
    const start = release * BLOCK;
    const burst =
      peak(loud.samples, start, 3, rate) / peak(quiet.samples, start, 20, rate);
    console.log(
      `${solver.padEnd(10)} ${word.padEnd(5)} ${(20 * Math.log10(burst)).toFixed(2).padStart(8)}`
    );
  }
}
