// Low-frequency acoustic mass of the 3D link network against the 1D tube
// (issue 9). Solves the potential flow from the glottis (potential 1) to
// the free air (potential 0) through link conductances and prints, per
// cm of arc, the potential drop (share of the total mass) next to the 1D
// share sum(dx / A). Usage:
//   node experiments/issue-9-inertance.mjs <vowel> <dx> [teeth]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { CELL_AIR, CELL_TRACT } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const [symbol = 'i', dxText = '0.5', teethText] = process.argv.slice(2);
const dx = Number(dxText);
const head = normalizeHeadConfig({});
const vowel = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  head
);
// UNIFORM=<area> replaces the vowel by a uniform tube of the rest length.
const s = process.env.UNIFORM
  ? {
      ...vowel,
      areas: vowel.areas.map(() => Number(process.env.UNIFORM)),
      length: 16.5,
    }
  : vowel;
const solver = new Fdtd3d({ head, dx, kernel: 'js' });
solver.setShape(s.areas, 0, s.velumIndex, teethText ? s.teeth : null);
const { cellCount, linkCount, linkA, linkB, conductance, cellKind } = solver;
const potential = new Float64Array(cellCount);
const fixed = new Uint8Array(cellCount);
for (const index of solver.sourceCells) {
  potential[index] = 1;
  fixed[index] = 1;
}
for (let index = 0; index < cellCount; index++) {
  if (cellKind[index] === CELL_AIR) {
    fixed[index] = 1;
  }
}
const neighbours = Array.from({ length: cellCount }, () => []);
for (let link = 0; link < linkCount; link++) {
  const g = conductance[link];
  if (g > 0) {
    neighbours[linkA[link]].push([linkB[link], g]);
    neighbours[linkB[link]].push([linkA[link], g]);
  }
}
for (let sweep = 0; sweep < 20000; sweep++) {
  let change = 0;
  for (let index = 0; index < cellCount; index++) {
    if (fixed[index] || neighbours[index].length === 0) {
      continue;
    }
    let sum = 0;
    let weight = 0;
    for (const [other, g] of neighbours[index]) {
      sum += g * potential[other];
      weight += g;
    }
    const next = sum / weight;
    change = Math.max(change, Math.abs(next - potential[index]));
    // Over-relaxation speeds up convergence.
    potential[index] += 1.9 * (next - potential[index]);
  }
  if (change < 1e-9) {
    break;
  }
}
// Total flow out of the source = network conductance (in dx units).
let flow = 0;
for (const index of solver.sourceCells) {
  for (const [other, g] of neighbours[index]) {
    flow += g * (1 - potential[other]);
  }
}
// Mass of the 3D network relative to a 1D tube: 1D mass = sum(l / A); the
// 3D network conductance G (dx² · per dx) gives mass dx / (G dx²).
const sectionLength = s.length / s.areas.length;
const mass1d = s.areas.reduce((sum, area) => sum + sectionLength / area, 0);
const rest = solver.model.lengths[CELL_TRACT];
const mass3d = (1 / (flow * dx)) * (s.length / rest);
let volume = 0;
for (let index = 0; index < cellCount; index++) {
  if (cellKind[index] === CELL_TRACT) {
    volume += solver.fill[index] * dx ** 3;
  }
}
const volume1d = s.areas.reduce((sum, area) => sum + area * sectionLength, 0);
console.log(
  `volume 1D ${volume1d.toFixed(1)} 3D ${((volume * s.length) / rest).toFixed(1)} cm³`
);
console.log(
  `/${symbol}/ dx ${dx}${teethText ? ' teeth' : ''}: mass 1D ${mass1d.toFixed(2)} 3D ${mass3d.toFixed(2)} (1/cm)`
);
// Mean potential per cm of arc against the 1D cumulative share.
const binSize = Number(process.env.BIN ?? 1);
const bins = new Map();
solver.model.cells.forEach((cell, index) => {
  if (cell.kind !== CELL_TRACT || neighbours[index].length === 0) {
    return;
  }
  const bin = Math.floor(cell.arc / binSize) * binSize;
  const entry = bins.get(bin) ?? { sum: 0, weight: 0 };
  entry.sum += potential[index] * solver.fill[index];
  entry.weight += solver.fill[index];
  bins.set(bin, entry);
});
let cumulative = 0;
const shares = [];
s.areas.forEach((area, index) => {
  cumulative += sectionLength / area;
  shares.push([((index + 1) * rest) / s.areas.length, 1 - cumulative / mass1d]);
});
for (const [bin, { sum, weight }] of [...bins].sort((a, b) => a[0] - b[0])) {
  const target = shares.find(([arc]) => arc >= bin + binSize / 2)?.[1] ?? 0;
  console.log(
    `arc ${String(bin).padStart(5)}-${bin + binSize} potential 3D ${(sum / weight).toFixed(3)} 1D ${target.toFixed(3)}`
  );
}
