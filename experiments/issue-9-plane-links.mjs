// Links of the 3D tract that cross the plane at one arc position: the
// fills of both cells and the link conductance, with and without incisors.
// Usage: node experiments/issue-9-plane-links.mjs [dx] [vowel] [arc cm]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { CELL_TRACT } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 0.5);
const symbol = process.argv[3] ?? 'ə';
const x = Number(process.argv[4] ?? 13.75);
const head = normalizeHeadConfig({});
const s = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  head
);
const solver = new Fdtd3d({ head, dx, kernel: 'js' });
const { cells } = solver.model;

function dump(label) {
  const rows = [];
  for (let link = 0; link < solver.linkCount; link++) {
    const i = solver.linkA[link];
    const j = solver.linkB[link];
    if (cells[i].kind !== CELL_TRACT || cells[j].kind !== CELL_TRACT) {
      continue;
    }
    const lo = Math.min(cells[i].arc, cells[j].arc);
    const hi = Math.max(cells[i].arc, cells[j].arc);
    if (!(lo < x && x <= hi)) {
      continue;
    }
    const p = (c) => c.point.map((v) => v.toFixed(2)).join(',');
    rows.push(
      `  [${p(cells[i])}] arc ${cells[i].arc.toFixed(2)} fill ${solver.fill[i].toFixed(2)} -> [${p(cells[j])}] arc ${cells[j].arc.toFixed(2)} fill ${solver.fill[j].toFixed(2)} g ${solver.conductance[link].toFixed(2)}`
    );
  }
  console.log(label, rows.length, 'links');
  console.log(rows.join('\n'));
}
solver.setShape(s.areas, 0, s.velumIndex, null);
dump('no teeth');
solver.setShape(s.areas, 0, s.velumIndex, s.teeth);
dump('with teeth');
