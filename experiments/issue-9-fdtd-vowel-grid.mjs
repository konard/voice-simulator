// RMS log formant error of the calibrated measured vowels in the 3D solver
// at several grid steps, on the typical male head.
// Usage: node experiments/issue-9-fdtd-vowel-grid.mjs [dx ...]
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

const head = presetHeadConfig('male');
const steps = process.argv.slice(2).map(Number);
for (const dx of steps.length ? steps : [1, 0.5]) {
  const voxels = buildVoxelModel(head, { dx });
  for (const name of ['i', 'ɑ', 'u', 'ɔ']) {
    const [height, backness, rounding] = STORY_FEATURES[name];
    const shape = tractShape({ height, backness, rounding }, head, {
      vowelCorrections: VOWEL_CORRECTIONS_3D,
    });
    const solver = new Fdtd3d({ model: voxels });
    solver.setNose(noseShape(head).areas);
    solver.setShape(
      shape.areas,
      shape.velumArea,
      shape.velumIndex,
      shape.teeth
    );
    const rate = 1 / solver.stepDuration(shape);
    const response = new Float64Array(Math.round(rate * 0.08));
    for (let n = 0; n < response.length; n++) {
      response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
    }
    const peaks = spectralPeaks(response, rate, { prominence: 0.5 })
      .filter((value) => value > 150)
      .slice(0, 3);
    const targets = HILLENBRAND.male[name];
    const error = Math.sqrt(
      targets.reduce((s, t, i) => s + Math.log(peaks[i] / t) ** 2, 0) / 3
    );
    console.log(
      `dx ${dx} /${name}/ ${peaks.map(Math.round).join(' ')} target ${targets.join(' ')} rms ${error.toFixed(3)}`
    );
  }
}
