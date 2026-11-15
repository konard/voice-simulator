/**
 * Issue 36: F1-F3 of the 3D vowel table on the male head
 * (tests/fdtd3d.test.js, "3D FDTD vowel table"), to compare commits:
 *   SOURCE=/tmp/main/src node experiments/issue-36-fdtd-table.mjs
 */
import { URL } from 'node:url';

const source = process.env.SOURCE
  ? new URL(`file://${process.env.SOURCE.replace(/\/?$/, '/')}`)
  : new URL('../src/', import.meta.url);
const load = (path) => import(new URL(path, source).href);
const { Fdtd3d } = await load('acoustics/fdtd3d.js');
const { buildVoxelModel } = await load('acoustics/voxel-model.js');
const { spectralPeaks } = await load('acoustics/analysis.js');
const { noseShape, tractShape } = await load('articulation/tract-shape.js');
const { presetHeadConfig } = await load('head-config.js');
const { VOWEL_CORRECTIONS_3D } = await load(
  'articulation/vowel-calibration.js'
);
const { HILLENBRAND } = await load('articulation/vowel-norms.js');
const { STORY_FEATURES } = await load('articulation/vowel-space.js');

const head = presetHeadConfig('male');
const voxels = buildVoxelModel(head, { dx: 0.5 });
for (const name of ['i', 'ɑ', 'u']) {
  const [height, backness, rounding] = STORY_FEATURES[name];
  const shape = tractShape({ height, backness, rounding }, head, {
    vowelCorrections: VOWEL_CORRECTIONS_3D,
  });
  const solver = new Fdtd3d({ model: voxels });
  solver.setNose(noseShape(head).areas);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
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
    targets.reduce((sum, t, i) => sum + Math.log(peaks[i] / t) ** 2, 0) / 3
  );
  console.log(
    name,
    peaks.map((p) => p.toFixed(0)).join(' '),
    'targets',
    targets.join(' '),
    'error',
    error.toFixed(4)
  );
}
