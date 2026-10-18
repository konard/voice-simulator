// Long impulse response of a static vowel: RMS per 50 ms window, to check
// that every mode of the 3D grid (pouches included) decays.
// Usage: node experiments/issue-9-long-decay.mjs [vowel] [dx] [seconds] [pouches on|off]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const [symbol = 'ɑ', dxText = '1', secondsText = '1', pouches = 'on'] =
  process.argv.slice(2);
const on = pouches === 'on';
const solver = new Fdtd3d({
  dx: Number(dxText),
  kernel: 'js',
  piriform: on,
  vallecula: on,
});
const shape = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  DEFAULT_HEAD
);
solver.setNose(noseShape(DEFAULT_HEAD).areas);
solver.setShape(shape.areas, 0);
const rate = 1 / solver.stepDuration();
const window = Math.round(rate * 0.05);
const total = Math.round(rate * Number(secondsText));
const levels = [];
let sum = 0;
let alternating = 0;
let previous = 0;
for (let n = 0; n < total; n++) {
  const out = solver.step(n === 0 ? 1 : 0, 0, 0);
  sum += out * out;
  alternating += out * previous < 0 ? 1 : 0;
  previous = out;
  if ((n + 1) % window === 0) {
    levels.push(`${(10 * Math.log10(sum / window + 1e-300)).toFixed(0)}`);
    sum = 0;
  }
}
console.log(
  `/${symbol}/ dx ${dxText} pouches ${pouches} dB per 50 ms:`,
  levels.join(' '),
  `| sign changes ${alternating}/${total}`
);
