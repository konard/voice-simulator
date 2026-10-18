// Effective flow area of the 3D tract across planes along the arc (sum of
// open link conductance x face area x |link . tangent| over the links that
// cross the plane) against the area function, with and without incisors.
// Usage: node experiments/issue-9-link-area.mjs [dx] [vowel] [from cm]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { CELL_TRACT } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 0.5);
const symbol = process.argv[3] ?? 'ə';
const from = Number(process.argv[4] ?? 12);
const head = normalizeHeadConfig({});
const s = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  head
);
const solver = new Fdtd3d({ head, dx, kernel: 'js' });
const { cells, lengths } = solver.model;
const length = lengths[CELL_TRACT];

function centroid(lo, hi) {
  const sum = [0, 0, 0];
  let count = 0;
  for (const cell of cells) {
    if (cell.kind === CELL_TRACT && cell.arc >= lo && cell.arc < hi) {
      cell.point.forEach((v, i) => (sum[i] += v));
      count++;
    }
  }
  return sum.map((v) => v / Math.max(count, 1));
}

function planeAreas() {
  const rows = [];
  for (let x = from; x < length; x += 0.25) {
    const a = centroid(x - dx, x);
    const b = centroid(x, x + dx);
    const t = b.map((v, i) => v - a[i]);
    const norm = Math.hypot(...t) || 1;
    let area = 0;
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
      const d = cells[j].point.map((v, k) => (v - cells[i].point[k]) / dx);
      const dot = Math.abs(d[0] * t[0] + d[1] * t[1] + d[2] * t[2]) / norm;
      area += solver.conductance[link] * dx * dx * dot;
    }
    const index = Math.min(
      s.areas.length - 1,
      Math.floor((x / length) * s.areas.length)
    );
    rows.push(
      `${x.toFixed(2)}:${s.areas[index].toFixed(2)}/${area.toFixed(2)}`
    );
  }
  return rows.join(' ');
}

console.log(
  `/${symbol}/ teeth ${JSON.stringify(s.teeth)} tract ${length.toFixed(2)} cm; arc:target/effective`
);
solver.setShape(s.areas, 0, s.velumIndex, null);
console.log('no teeth  ', planeAreas());
solver.setShape(s.areas, 0, s.velumIndex, s.teeth);
console.log('with teeth', planeAreas());
