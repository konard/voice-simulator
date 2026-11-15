// Where does the vallecula put its zero? Level (dB) of the transfer function
// with the vallecula minus without it, in 250 Hz bands from 3 to 8 kHz, for
// /ɑ/ on the male reference head: 2D sheet at several dx and the 3D solver.
// Usage: node experiments/issue-37-vallecula-zero.mjs [vowel] [dx3d]
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { VOWEL_CORRECTIONS_2D } from '../src/articulation/vowel-calibration.js';
import { STORY_FEATURES } from '../src/articulation/vowel-space.js';
import { presetHeadConfig } from '../src/head-config.js';

const name = process.argv[2] ?? 'ɑ';
const dx3d = Number(process.argv[3] ?? 0.5);
const head = presetHeadConfig('male');
const nose = noseShape(head).areas;
const [height, backness, rounding] = STORY_FEATURES[name];
const shape = tractShape({ height, backness, rounding }, head, {
  vowelCorrections: VOWEL_CORRECTIONS_2D,
});
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
const bands = [];
for (let from = 3000; from < 8000; from += 250) {
  bands.push([from, from + 50, from + 100, from + 150, from + 200]);
}
const bandLevels = (result) =>
  bands.map((band) => {
    const energy = band.map((f) => 10 ** (level(result, f) / 10));
    return 10 * Math.log10(energy.reduce((a, b) => a + b) / energy.length);
  });
const show = (label, on, off) =>
  console.log(
    label.padEnd(12),
    on.map((v, i) => (v - off[i]).toFixed(0).padStart(4)).join('')
  );
console.log(
  `/${name}/ kHz`.padEnd(12),
  bands.map(([f]) => (f / 1000).toFixed(1).padStart(4)).join('')
);
for (const dx of [0.8, 0.6, 0.5, 0.4, 0.3]) {
  const run = (vallecula) => {
    const s = new Fdtd2d({ head, dx, vallecula });
    s.setNose(nose);
    s.setShape(shape.areas, 0, shape.velumIndex, shape.teeth, shape);
    s.setLength(shape.length);
    const line = s.branches.find((b) => b.name === 'vallecula')?.line;
    return {
      levels: bandLevels(impulse(s, 1 / s.stepDuration(shape))),
      n: line?.n,
    };
  };
  const on = run(true);
  show(`2D ${dx} (${on.n})`, on.levels, run(false).levels);
}
const levels3d = [true, false].map((vallecula) => {
  const model = buildVoxelModel(head, { dx: dx3d, vallecula });
  const s = new Fdtd3d({ model });
  s.setNose(nose);
  s.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
  return bandLevels(impulse(s, 1 / s.stepDuration(shape)));
});
show(`3D ${dx3d}`, ...levels3d);
