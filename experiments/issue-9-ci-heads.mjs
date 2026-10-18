// Random heads of the CI check: /ə/ and /i/ resonances of the waveguide
// with the tube vowel table against the 3D solver (1 cm grid) with its own
// table, and the straight tube for scale.
//
//   node experiments/issue-9-ci-heads.mjs [count] [dx] [seed indices, comma-separated]
import {
  Fdtd3d,
  Waveguide,
  buildVoxelModel,
  getPhoneme,
  noseShape,
  randomHeadConfig,
  spectralPeaks,
  tractShape,
  tubeFormants,
} from '../src/index.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';

const count = Number(process.argv[2] ?? 24);
const dx = Number(process.argv[3] ?? 1);
const picked = process.argv[4]?.split(',').map(Number);
const nearest = (peaks, target) =>
  peaks.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best
  );
function shapeOf(symbol, head, table, sections) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    head,
    { sections, vowelCorrections: table }
  );
}
function peaksOf(solver, rate) {
  const response = new Float64Array(Math.round(rate * 0.08));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { step: 5, floor: 12 });
}
let worst = 0;
const indices =
  picked ?? Array.from({ length: Math.ceil(count / 4) }, (_, k) => 4 * k);
for (const index of indices) {
  const head = randomHeadConfig(`ci-${index}`);
  const model = buildVoxelModel(head, { dx });
  const row = [`ci-${index}`];
  for (const symbol of ['ə', 'i']) {
    const tubeShape = shapeOf(symbol, head, undefined, 44);
    const tube = tubeFormants(tubeShape.areas, tubeShape.length, { count: 2 });
    const guide = new Waveguide({ sections: 44 });
    guide.setNose(noseShape(head).areas);
    guide.setShape(tubeShape.areas, 0);
    const guidePeaks = peaksOf(guide, (44 * SPEED_OF_SOUND) / tubeShape.length);
    const wg = tube.map((target) => nearest(guidePeaks, target));
    const shape = shapeOf(symbol, head, VOWEL_CORRECTIONS_3D);
    const solver = new Fdtd3d({ model });
    solver.setNose(noseShape(head).areas);
    solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
    const fdtd = wg.map((target) =>
      nearest(peaksOf(solver, 1 / solver.stepDuration(shape)), target)
    );
    const errors = fdtd.map((value, k) => Math.abs(value - wg[k]) / wg[k]);
    worst = Math.max(worst, ...errors);
    row.push(
      `/${symbol}/ tube ${tube.map(Math.round).join('/')} wg ${wg.join('/')} 3d ${fdtd.join('/')} (${errors.map((e) => (e * 100).toFixed(0)).join('/')}%)`
    );
  }
  console.log(row.join('  '));
}
console.log(`worst 3D vs waveguide ${(worst * 100).toFixed(1)}%`);
