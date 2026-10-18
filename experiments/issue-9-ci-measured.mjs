// The 3D solver with its own vowel table against the mean formants of men
// (Hillenbrand et al. 1995): the first three impulse-response peaks above
// 150 Hz, read with the step time of the vowel's tract length, on the
// default and the male preset head.
//
//   node experiments/issue-9-ci-measured.mjs [dx]
import {
  DEFAULT_HEAD,
  Fdtd3d,
  buildVoxelModel,
  noseShape,
  spectralPeaks,
  tractShape,
} from '../src/index.js';
import { presetHeadConfig } from '../src/head-config.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';

const dx = Number(process.argv[2] ?? 0.6);
for (const [label, head] of [
  ['default', DEFAULT_HEAD],
  ['male', presetHeadConfig('male')],
]) {
  const model = buildVoxelModel(head, { dx });
  let worst = 0;
  for (const name of Object.keys(STORY_FEATURES)) {
    const targets = HILLENBRAND.male[name];
    if (!targets) {
      continue;
    }
    const [height, backness, rounding] = STORY_FEATURES[name];
    const shape = tractShape({ height, backness, rounding }, head, {
      vowelCorrections: VOWEL_CORRECTIONS_3D,
    });
    const solver = new Fdtd3d({ model });
    solver.setNose(noseShape(head).areas);
    solver.setShape(
      shape.areas,
      shape.velumArea,
      shape.velumIndex,
      shape.teeth
    );
    const rate = 1 / solver.stepDuration(shape);
    const response = new Float64Array(Math.round(rate * 0.1));
    for (let n = 0; n < response.length; n++) {
      response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
    }
    const peaks = spectralPeaks(response, rate, { step: 2, prominence: 0.5 })
      .filter((value) => value > 150)
      .slice(0, 3);
    const errors = targets.map((target, index) =>
      Math.abs(peaks[index] / target - 1)
    );
    worst = Math.max(worst, ...errors.slice(0, 2));
    console.log(
      `${label} dx=${dx} /${name}/ measured ${targets.join('/')} fdtd ${peaks.join('/')} errors ${errors.map((e) => (e * 100).toFixed(0)).join('/')}%`
    );
  }
  console.log(`${label}: worst F1/F2 error ${(worst * 100).toFixed(1)}%`);
}
