// Uniform-tube formants of the 2D sheet for several cell sizes:
// node experiments/issue-37-convergence.mjs
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const head = { ...DEFAULT_HEAD, vocalTractLength: 17.5 };
const tube = new Array(44).fill(3);
for (const dx of [0.8, 0.6, 0.4, 0.25]) {
  const s = new Fdtd2d({ head, dx, piriform: false, vallecula: false });
  s.setShape(tube, 0);
  s.setLength(17.5);
  const rate = 1 / s.stepDuration({ length: 17.5 });
  const response = new Float64Array(Math.round(rate * 0.1));
  for (let n = 0; n < response.length; n++) {
    response[n] = s.step(n === 0 ? 1 : 0, 0, 0);
  }
  const p = spectralPeaks(response, rate, { prominence: 0.5, step: 2 }).slice(
    0,
    4
  );
  console.log(
    dx,
    s.columns,
    s.restLength.toFixed(2),
    p.map(Math.round).join(' ')
  );
}
console.log(
  'tube',
  tubeFormants(tube, 17.5, { count: 4 }).map(Math.round).join(' ')
);
