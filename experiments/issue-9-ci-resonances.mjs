// The CI resonance check (scripts/check-simulation.mjs) on the default head
// at 0.6 cm: the 3D impulse-response peaks read with the solver's own step
// time against the shape's, with and without the 3D vowel table, next to
// the tube model and the measured formants of men.
//
//   node experiments/issue-9-ci-resonances.mjs [dx]
import {
  DEFAULT_HEAD,
  Fdtd3d,
  buildVoxelModel,
  getPhoneme,
  noseShape,
  spectralPeaks,
  tractShape,
  tubeFormants,
} from '../src/index.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';

const dx = Number(process.argv[2] ?? 0.6);
const model = buildVoxelModel(DEFAULT_HEAD, { dx });
const nearest = (peaks, target) =>
  peaks.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best
  );
for (const symbol of ['i', 'e', 'a', 'ɑ', 'o', 'u', 'ə']) {
  const row = [`/${symbol}/`];
  for (const table of [undefined, VOWEL_CORRECTIONS_3D]) {
    const shape = tractShape(
      { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
      DEFAULT_HEAD,
      { vowelCorrections: table }
    );
    const tube = tubeFormants(shape.areas, shape.length, { count: 2 });
    for (const full of [false, true]) {
      const solver = new Fdtd3d({ model });
      solver.setNose(noseShape(DEFAULT_HEAD).areas);
      if (full) {
        solver.setShape(
          shape.areas,
          shape.velumArea,
          shape.velumIndex,
          shape.teeth
        );
      } else {
        solver.setShape(shape.areas, 0);
      }
      const rate = 1 / solver.stepDuration(full ? shape : undefined);
      const response = new Float64Array(Math.round(rate * 0.08));
      for (let n = 0; n < response.length; n++) {
        response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
      }
      const peaks = spectralPeaks(response, rate, { step: 5, floor: 12 });
      const found = tube.map((target) => nearest(peaks, target));
      row.push(
        `${table ? '3d' : 'tube'}-table ${full ? 'shape' : 'bare '}: tube ${tube.map(Math.round).join('/')} fdtd ${found.join('/')}`
      );
    }
  }
  console.log(row.join('\n   '));
}
console.log(
  `model length ${model.lengths[1]?.toFixed?.(2)} cells ${model.cells.length}`
);
