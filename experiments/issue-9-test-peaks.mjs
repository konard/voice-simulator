/**
 * Peaks of the 3D model at the test grid (dx 1) against the tube model,
 * with and without the piriform fossae. Args: [dx]
 */
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const dx = Number(process.argv[2] ?? 1);
const bare = buildVoxelModel(DEFAULT_HEAD, {
  dx,
  piriform: false,
  vallecula: false,
});
const piriform = buildVoxelModel(DEFAULT_HEAD, { dx, vallecula: false });
const shapeOf = (s) =>
  tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(s) }), rhotic: 0 },
    DEFAULT_HEAD
  );
function peaks(solver, rate, seconds = 0.06) {
  const r = new Float64Array(Math.round(rate * seconds));
  for (let n = 0; n < r.length; n++) {
    r[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(r, rate, {
    floor: Number(process.env.FLOOR ?? Infinity),
    prominence: 0.5,
  }).map(Math.round);
}
function p3(shape, model) {
  const s = new Fdtd3d({ model });
  s.setNose(noseShape(DEFAULT_HEAD).areas);
  s.setShape(shape.areas, 0);
  return peaks(s, 1 / s.stepDuration(shape));
}
function pw(shape, piri) {
  const s = new Waveguide({ sections: shape.areas.length, piriform: piri });
  s.setNose(noseShape(DEFAULT_HEAD).areas);
  s.setShape(shape.areas, 0);
  s.setLength?.(shape.length);
  return peaks(s, (shape.areas.length * SPEED_OF_SOUND) / shape.length);
}
for (const v of ['ə', 'i', 'ɑ', 'u']) {
  const sh = shapeOf(v);
  console.log(
    `/${v}/ tube ${tubeFormants(sh.areas, sh.length, { count: 3 }).map(Math.round).join(' ')}`
  );
  console.log(`  3D bare     ${p3(sh, bare).slice(0, 5).join(' ')}`);
  console.log(`  3D piriform ${p3(sh, piriform).slice(0, 5).join(' ')}`);
  console.log(`  wg          ${pw(sh, false).slice(0, 5).join(' ')}`);
  console.log(`  wg piriform ${pw(sh, true).slice(0, 5).join(' ')}`);
}
