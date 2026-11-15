// Transverse resonance across a tube 6 cm wide and 1 cm deep, driven in
// one corner, against the waveguide of the same area:
// node experiments/issue-37-wide-tube.mjs
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const solver = new Fdtd2d({
  head: DEFAULT_HEAD,
  piriform: false,
  vallecula: false,
});
const { columns, rows } = solver;
solver.setDepths(new Float64Array(columns * rows).fill(1));
const width = rows * solver.dx;
const rate = 1 / solver.dt;
const response = new Float64Array(Math.round(rate * 0.08));
const receiver = (columns - 1) * rows + rows - 1; // opposite corner at the lips
for (let n = 0; n < response.length; n++) {
  if (n === 0) {
    solver.pressure[0] = 1;
  }
  solver.step(0, 0, 0);
  response[n] = solver.pressure[receiver];
}
const options = { prominence: 1, from: 200, to: 5000 };
console.log(
  'grid',
  columns,
  'x',
  rows,
  'width',
  width.toFixed(2),
  'length',
  solver.restLength.toFixed(2)
);
console.log('expected', Math.round(SPEED_OF_SOUND / (2 * width)));
console.log(
  '2D peaks',
  spectralPeaks(response, rate, options).map(Math.round).join(' ')
);
const wave = new Waveguide({ sections: 44, piriform: false });
wave.setShape(new Array(44).fill(width), 0);
wave.setLength(solver.restLength);
const waveRate = (44 * SPEED_OF_SOUND) / solver.restLength;
const waveResponse = new Float64Array(Math.round(waveRate * 0.08));
for (let n = 0; n < waveResponse.length; n++) {
  waveResponse[n] = wave.step(n === 0 ? 1 : 0, 0, 0);
}
console.log(
  'wg peaks',
  spectralPeaks(waveResponse, waveRate, options).map(Math.round).join(' ')
);
