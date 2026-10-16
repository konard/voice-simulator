// Print the impulse-response spectrum of the 3D FDTD solver around its
// peaks for one vowel, to tell real resonances from DFT ripple.
// Usage: node experiments/fdtd-open-vowel-peaks.mjs [vowel] [dx] [seconds]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const symbol = process.argv[2] ?? 'a';
const dx = Number(process.argv[3] ?? 0.6);
const seconds = Number(process.argv[4] ?? 0.08);
const model = buildVoxelModel(DEFAULT_HEAD, { dx });
const target = vowelTarget({ phoneme: getPhoneme(symbol) });
const shape = tractShape({ ...target, rhotic: 0 }, DEFAULT_HEAD);
const solver = new Fdtd3d({ model });
solver.setNose(noseShape(DEFAULT_HEAD).areas);
solver.setShape(shape.areas, target.velum ?? 0);
const rate = 1 / solver.stepDuration();
const response = new Float64Array(Math.round(rate * seconds));
for (let n = 0; n < response.length; n++) {
  response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
}
const tail = Math.max(...response.slice(-200).map(Math.abs));
const head = Math.max(...response.map(Math.abs));
console.log(
  `rate ${Math.round(rate)} tail/peak ${(tail / head).toExponential(2)}`
);
console.log(
  'tube',
  tubeFormants(shape.areas, shape.length, { count: 3 }).map(Math.round)
);
const rows = [];
for (let f = 100; f <= 4000; f += 5) {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * f) / rate;
  for (let n = 0; n < response.length; n++) {
    re += response[n] * Math.cos(w * n);
    im -= response[n] * Math.sin(w * n);
  }
  rows.push([f, Math.hypot(re, im)]);
}
const max = Math.max(...rows.map((r) => r[1]));
for (let i = 1; i < rows.length - 1; i++) {
  if (rows[i][1] > rows[i - 1][1] && rows[i][1] > rows[i + 1][1]) {
    console.log(
      rows[i][0],
      (20 * Math.log10(rows[i][1] / max)).toFixed(1),
      'dB'
    );
  }
}
