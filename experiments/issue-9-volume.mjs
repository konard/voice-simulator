// Air volume (acoustic compliance) of the 3D tract cells against the 1D
// tube volume sum(A dl) at the rest length (issue 9).
// Usage: node experiments/issue-9-volume.mjs <vowel> <dx> [teeth]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { CELL_TRACT } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const [symbol = 'ə', dxText = '0.5', teethText] = process.argv.slice(2);
const dx = Number(dxText);
const head = normalizeHeadConfig({});
const s = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  head
);
const solver = new Fdtd3d({ head, dx, kernel: 'js' });
solver.setShape(s.areas, 0, s.velumIndex, teethText ? s.teeth : null);
const rest = solver.model.lengths[CELL_TRACT];
const volume1d =
  s.areas.reduce((sum, a) => sum + a, 0) * (rest / s.areas.length);
const bins = new Float64Array(Math.ceil(rest));
let volume3d = 0;
for (let i = 0; i < solver.cellCount; i++) {
  if (solver.cellKind[i] !== CELL_TRACT || solver.solid[i]) {
    continue;
  }
  const v = solver.fill[i] * dx ** 3;
  volume3d += v;
  bins[Math.min(bins.length - 1, Math.floor(solver.cellArc[i]))] += v;
}
console.log(
  `/${symbol}/ dx ${dx}: volume 1D ${volume1d.toFixed(1)} 3D ${volume3d.toFixed(1)} cm³`
);
for (let b = 0; b < bins.length; b++) {
  let a1 = 0;
  for (let k = 0; k < s.areas.length; k++) {
    const arc = ((k + 0.5) / s.areas.length) * rest;
    if (arc >= b && arc < b + 1) {
      a1 += s.areas[k] * (rest / s.areas.length);
    }
  }
  console.log(`arc ${b}-${b + 1} 3D ${bins[b].toFixed(2)} 1D ${a1.toFixed(2)}`);
}
