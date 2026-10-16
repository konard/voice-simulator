// Impulse response of the 3D FDTD tract for a static vowel; prints the
// spectral peaks next to the chain-matrix tube formants.
// Usage: node experiments/fdtd-impulse.mjs [vowel] [dx] [flow|microphone]
import { tractShape, noseShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const symbol = process.argv[2] ?? 'ə';
const dx = Number(process.argv[3] ?? 0.8);
const output = process.argv[4] ?? 'flow';
const shape = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  DEFAULT_HEAD
);
const solver = new Fdtd3d({ head: DEFAULT_HEAD, dx, output });
solver.setNose(noseShape(DEFAULT_HEAD).areas);
solver.setShape(shape.areas, 0);
const rate = 1 / solver.stepDuration();
const steps = Math.round(rate * 0.1);
const response = new Float64Array(steps);
for (let n = 0; n < steps; n++) {
  response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
}
const spectrum = [];
for (let f = 50; f <= 5000; f += 10) {
  let re = 0;
  let im = 0;
  for (let n = 0; n < steps; n++) {
    re += response[n] * Math.cos((2 * Math.PI * f * n) / rate);
    im -= response[n] * Math.sin((2 * Math.PI * f * n) / rate);
  }
  spectrum.push([f, Math.hypot(re, im)]);
}
const peaks = spectrum
  .filter(
    ([, m], i) =>
      i > 0 &&
      i < spectrum.length - 1 &&
      m > spectrum[i - 1][1] &&
      m > spectrum[i + 1][1]
  )
  .map(([f, m]) => `${f}:${(20 * Math.log10(m)).toFixed(0)}dB`);
const tube = tubeFormants(shape.areas, shape.length, { count: 4 });
console.log(
  `rate ${Math.round(rate)} cells ${solver.cellCount} links ${solver.linkCount}`
);
console.log('fdtd peaks', peaks.join(' '));
console.log(
  'tube',
  tube.map(Math.round).join(' '),
  'length',
  shape.length.toFixed(2)
);
console.log(
  'max |response|',
  Math.max(...response.map(Math.abs)).toExponential(2)
);
