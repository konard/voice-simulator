// Where does the 2D sheet's 4-8 kHz level differ from 3D? Level (dB, relative
// to the mean below 4 kHz) of fdtd3d (dx 0.5), fdtd2d and the waveguide in
// 500 Hz bands, for a few vowels, each solver with its own vowel table.
// Usage: node experiments/issue-37-high-band.mjs [vowels] [dx2d]
// Env: VALL=0 turns the 2D vallecula off, PIRI=0 the 2D piriform fossae.
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import {
  VOWEL_CORRECTIONS,
  VOWEL_CORRECTIONS_2D,
  VOWEL_CORRECTIONS_3D,
} from '../src/articulation/vowel-calibration.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

const vowels = (process.argv[2] ?? 'ɑ,ɔ,ʌ,i').split(',');
const dx2d = Number(process.argv[3] ?? 0.6);
const head = presetHeadConfig('male');
const nose = noseShape(head).areas;
const tract = (name, table) => {
  const [height, backness, rounding] = STORY_FEATURES[name];
  return tractShape({ height, backness, rounding }, head, {
    vowelCorrections: table,
  });
};
const impulse = (solver, rate) => {
  const response = new Float64Array(Math.round(rate * 0.1));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return { response, rate };
};
const level = ({ response, rate }, frequency) => {
  const omega = (2 * Math.PI * frequency) / rate;
  let re = 0;
  let im = 0;
  for (let n = 0; n < response.length; n++) {
    re += response[n] * Math.cos(omega * n);
    im -= response[n] * Math.sin(omega * n);
  }
  return 20 * Math.log10(Math.hypot(re, im) + 1e-30);
};
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const grid = (from, to) =>
  Array.from({ length: (to - from) / 50 + 1 }, (_, i) => from + 50 * i);
const bands = [];
for (let from = 0; from < 8000; from += 500) {
  bands.push(grid(Math.max(from, 100), from + 450));
}
function profile(result) {
  const offset = mean(grid(100, 4000).map((f) => level(result, f)));
  return bands.map((band) => mean(band.map((f) => level(result, f))) - offset);
}
const model = buildVoxelModel(head, { dx: 0.5 });
console.log(
  'band start (kHz)',
  bands.map((band, i) => (i / 2).toFixed(1).padStart(6)).join('')
);
for (const name of vowels) {
  let shape = tract(name, VOWEL_CORRECTIONS_3D);
  const s3 = new Fdtd3d({ model });
  s3.setNose(nose);
  s3.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  const p3 = profile(impulse(s3, 1 / s3.stepDuration(shape)));
  shape = tract(name, VOWEL_CORRECTIONS_2D);
  const s2 = new Fdtd2d({
    head,
    dx: dx2d,
    vallecula: process.env.VALL !== '0',
    piriform: process.env.PIRI !== '0',
  });
  s2.setNose(nose);
  s2.setShape(
    shape.areas,
    shape.velumArea,
    shape.velumIndex,
    shape.teeth,
    shape
  );
  s2.setLength(shape.length);
  const p2 = profile(impulse(s2, 1 / s2.stepDuration(shape)));
  shape = tract(name, VOWEL_CORRECTIONS);
  const w = new Waveguide({ sections: shape.areas.length, head });
  w.setNose(nose);
  w.setShape(shape.areas, shape.velumArea, shape.velumIndex);
  w.setLength(shape.length);
  const pw = profile(
    impulse(w, (shape.areas.length * SPEED_OF_SOUND) / shape.length)
  );
  const row = (label, values) =>
    console.log(
      `/${name}/ ${label}`.padEnd(16),
      values.map((v) => v.toFixed(1).padStart(6)).join('')
    );
  row('3D', p3);
  row('2D', p2);
  row('waveguide', pw);
}
