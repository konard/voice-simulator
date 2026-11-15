// Uniform tube and vowel formants of the 2D sheet against the waveguide
// and the tube model: node experiments/issue-37-tube.mjs
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

function peaks(solver, rate, seconds = 0.08) {
  const response = new Float64Array(Math.round(rate * seconds));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { prominence: 0.5 }).map(Math.round);
}

const head = { ...DEFAULT_HEAD, vocalTractLength: 17.5 };
const tube = new Array(44).fill(3);
const s = new Fdtd2d({ head, piriform: false, vallecula: false });
s.setShape(tube, 0);
s.setLength(17.5);
console.log(
  'grid',
  s.columns,
  'x',
  s.rows,
  'length',
  s.restLength.toFixed(2),
  'rate',
  Math.round(1 / s.stepDuration({ length: 17.5 }))
);
console.log(
  '2D tube  ',
  peaks(s, 1 / s.stepDuration({ length: 17.5 })).slice(0, 5)
);
console.log(
  'tube model',
  tubeFormants(tube, 17.5, { count: 5 }).map(Math.round)
);
const w = new Waveguide({ sections: 44, piriform: false });
w.setShape(tube, 0);
w.setLength(17.5);
console.log('waveguide', peaks(w, (44 * SPEED_OF_SOUND) / 17.5).slice(0, 5));

for (const symbol of ['ɑ', 'i', 'u', 'ɛ', 'o']) {
  const shape = tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
  const a = new Fdtd2d({
    head: DEFAULT_HEAD,
    vallecula: process.env.VALL === '1',
  });
  a.setShape(shape.areas, 0, shape.velumIndex, shape.teeth, shape);
  a.setLength(shape.length);
  const b = new Waveguide({ sections: shape.areas.length });
  b.setShape(shape.areas, 0);
  b.setLength(shape.length);
  const p2 = peaks(a, 1 / a.stepDuration(shape)).slice(0, 4);
  const p1 = peaks(
    b,
    (shape.areas.length * SPEED_OF_SOUND) / shape.length
  ).slice(0, 4);
  console.log(
    symbol,
    '2D',
    p2.join(' '),
    '| wg',
    p1.join(' '),
    '| err%',
    p1
      .slice(0, 3)
      .map((f, i) => ((100 * (p2[i] - f)) / f).toFixed(1))
      .join(' ')
  );
}
