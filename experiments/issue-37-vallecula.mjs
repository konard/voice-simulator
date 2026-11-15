// How far the vallecula lowers F1-F3 of /ɑ/, /ɔ/ and /i/ in the 2D sheet
// and in the 3D solver (1 cm cells): both pouches on, then only the
// piriform fossae. node experiments/issue-37-vallecula.mjs [dx3d]
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { spectralPeaks } from '../src/acoustics/analysis.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const dx3d = Number(process.argv[2] ?? 1);
function peaks(solver, rate) {
  const response = new Float64Array(Math.round(rate * 0.1));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { step: 2, prominence: 0.5 })
    .filter((value) => value > 150)
    .slice(0, 3);
}
const models = [true, false].map((vallecula) =>
  buildVoxelModel(DEFAULT_HEAD, { dx: dx3d, vallecula })
);
for (const symbol of ['ɑ', 'ɔ', 'i']) {
  const shape = tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
  const row = [];
  for (const vallecula of [true, false]) {
    const sheet = new Fdtd2d({ head: DEFAULT_HEAD, vallecula });
    sheet.setNose(noseShape(DEFAULT_HEAD).areas);
    sheet.setShape(shape.areas, 0, shape.velumIndex, null, shape);
    sheet.setLength(shape.length);
    row.push(peaks(sheet, 1 / sheet.stepDuration(shape)));
  }
  for (const model of models) {
    const solver = new Fdtd3d({ model });
    solver.setNose(noseShape(DEFAULT_HEAD).areas);
    solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
    row.push(peaks(solver, 1 / solver.stepDuration(shape)));
  }
  const ratio = (a, b) =>
    a
      .map((value, index) => (100 * (value / b[index] - 1)).toFixed(1))
      .join(' ');
  console.log(
    `/${symbol}/ 2D ${row[0].join(' ')} / ${row[1].join(' ')} (${ratio(row[0], row[1])} %)`,
    `| 3D ${row[2].join(' ')} / ${row[3].join(' ')} (${ratio(row[2], row[3])} %)`
  );
}
