// Impulse-response resonances of both solvers versus the tube model over
// many random heads, to choose robust tolerances for the CI head check.
// Usage: node experiments/random-head-resonances.mjs [heads] [dx] [vowels]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { randomHeadConfig } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const heads = Number(process.argv[2] ?? 100);
const dx = Number(process.argv[3] ?? 1);
const vowels = (process.argv[4] ?? 'a,ɑ,ə,i').split(',');
const SECTIONS = 44;

function impulse(solver, rate) {
  const response = new Float64Array(Math.round(rate * 0.08));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { step: 5, floor: 12 });
}

const nearest = (peaks, target) =>
  peaks.reduce(
    (best, value) =>
      Math.abs(value - target) < Math.abs(best - target) ? value : best,
    Infinity
  );

const worst = {};
for (let index = 0; index < heads; index++) {
  const head = randomHeadConfig(`ci-${index}`);
  const model = buildVoxelModel(head, { dx });
  for (const symbol of vowels) {
    const target = vowelTarget({ phoneme: getPhoneme(symbol) });
    const state = { ...target, rhotic: 0 };
    const tube = tubeFormants(
      tractShape(state, head).areas,
      tractShape(state, head).length,
      { count: 2 }
    );
    const shape = tractShape(state, head, { sections: SECTIONS });
    const waveguide = new Waveguide({ sections: SECTIONS });
    waveguide.setNose(noseShape(head).areas);
    waveguide.setShape(shape.areas, 0);
    const fdtd = new Fdtd3d({ model });
    fdtd.setNose(noseShape(head).areas);
    fdtd.setShape(tractShape(state, head).areas, 0);
    const results = {
      waveguide: impulse(waveguide, (SECTIONS * SPEED_OF_SOUND) / shape.length),
      fdtd3d: impulse(fdtd, 1 / fdtd.stepDuration()),
    };
    for (const [solver, peaks] of Object.entries(results)) {
      tube.forEach((value, formant) => {
        const error = Math.abs(nearest(peaks, value) - value) / value;
        const key = `${solver} /${symbol}/ F${formant + 1}`;
        if (!worst[key] || error > worst[key].error) {
          worst[key] = { error: +error.toFixed(3), seed: `ci-${index}` };
        }
      });
    }
  }
}
for (const [key, value] of Object.entries(worst)) {
  console.log(key, value.error, value.seed);
}
