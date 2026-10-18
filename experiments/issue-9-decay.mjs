// RMS of the 3D impulse response per 10 ms window: a ringing or growing
// mode shows as a level that does not fall (issue 9).
// Usage: node experiments/issue-9-decay.mjs <dx> <vowel>
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const [dx = '1', vowel = 'u'] = process.argv.slice(2);
const solver = new Fdtd3d({ dx: Number(dx) });
const s = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(vowel) }), rhotic: 0 },
  normalizeHeadConfig({})
);
solver.setShape(s.areas, 0, s.velumIndex, s.teeth ?? null);
const rate = 1 / solver.stepDuration();
const window = Math.round(rate * 0.01);
const levels = [];
let sum = 0;
for (let n = 0; n < window * 15; n++) {
  const y = solver.step(n === 0 ? 1 : 0, 0, 0);
  sum += y * y;
  if ((n + 1) % window === 0) {
    levels.push((10 * Math.log10(sum / window + 1e-30)).toFixed(0));
    sum = 0;
  }
}
console.log(
  `/${vowel}/ dx ${dx} rate ${Math.round(rate)} dB per 10 ms:`,
  levels.join(' ')
);
