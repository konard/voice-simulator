// Air volume of the 3D tract per arc bin, with and without the side
// pouches, against the area function (issue 9 preset study).
// Usage: node experiments/issue-9-tract-volume.mjs [dx] [vowel]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel, CELL_SINUS } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 0.5);
const symbol = process.argv[3] ?? 'ə';
const head = normalizeHeadConfig({});
const s = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  head
);
const bins = 8;
const target = new Float64Array(bins);
s.areas.forEach((area, i) => {
  target[Math.floor(((i + 0.5) / s.areas.length) * bins)] +=
    (area * s.length) / s.areas.length;
});
console.log(`/${symbol}/ length ${s.length.toFixed(2)} target volume per bin`);
console.log(`  ${[...target].map((v) => v.toFixed(2)).join(' ')}`);
for (const pouches of [true, false]) {
  const model = buildVoxelModel(head, {
    dx,
    piriform: pouches,
    vallecula: pouches,
  });
  const solver = new Fdtd3d({ head, model });
  solver.setShape(s.areas, 0, s.velumIndex, null);
  const volume = new Float64Array(bins);
  const sinus = {};
  model.cells.forEach((cell, index) => {
    const v = solver.fill[index] * dx ** 3;
    if (cell.kind === 0) {
      const bin = Math.min(
        bins - 1,
        Math.floor((cell.arc / model.lengths[0]) * bins)
      );
      volume[bin] += v;
    } else if (cell.kind === CELL_SINUS) {
      sinus[cell.tube] = (sinus[cell.tube] ?? 0) + v;
    }
  });
  console.log(
    `pouches ${pouches}: tract ${[...volume].map((v) => v.toFixed(2)).join(' ')} | pouches ${Object.values(
      sinus
    )
      .map((v) => v.toFixed(2))
      .join(' ')} | floors ${solver.openingFloors.length}`
  );
}
