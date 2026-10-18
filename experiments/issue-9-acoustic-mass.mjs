// Acoustic mass of windows of the 3D tract against the area function:
// cells before the window held at pressure 1 and after it at 0, the
// steady flow through the link conductances (conjugate gradients) gives
// the 3D inertance per rho, compared with the 1D integral of ds / A.
// Usage: node experiments/issue-9-acoustic-mass.mjs [dx] [vowel] [window cm]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { CELL_TRACT } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 0.5);
const symbol = process.argv[3] ?? 'ə';
const window = Number(process.argv[4] ?? 1.5);
const head = normalizeHeadConfig({});
const s = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
  head
);
const solver = new Fdtd3d({ head, dx, kernel: 'js' });
const { cells, lengths } = solver.model;
const length = lengths[CELL_TRACT];
const tract = [];
cells.forEach((cell, index) => {
  if (cell.kind === CELL_TRACT) {
    tract.push(index);
  }
});

// eslint-disable-next-line complexity -- one-off conjugate-gradient probe
function mass3d(lo, hi) {
  const fixed = new Map();
  const free = [];
  for (const index of tract) {
    const arc = cells[index].arc;
    if (arc < lo) {
      fixed.set(index, 1);
    } else if (arc > hi) {
      fixed.set(index, 0);
    } else {
      free.push(index);
    }
  }
  const slot = new Map(free.map((index, at) => [index, at]));
  const edges = [];
  for (let link = 0; link < solver.linkCount; link++) {
    const a = solver.linkA[link];
    const b = solver.linkB[link];
    const g = solver.conductance[link] * dx;
    if (
      g <= 0 ||
      cells[a].kind !== CELL_TRACT ||
      cells[b].kind !== CELL_TRACT
    ) {
      continue;
    }
    if (slot.has(a) || slot.has(b)) {
      edges.push([a, b, g]);
    }
  }
  const n = free.length;
  const diag = new Float64Array(n);
  const rhs = new Float64Array(n);
  for (const [a, b, g] of edges) {
    for (const [u, v] of [
      [a, b],
      [b, a],
    ]) {
      if (!slot.has(u)) {
        continue;
      }
      diag[slot.get(u)] += g;
      if (!slot.has(v)) {
        rhs[slot.get(u)] += g * fixed.get(v);
      }
    }
  }
  const apply = (x, out) => {
    for (let i = 0; i < n; i++) {
      out[i] = diag[i] * x[i];
    }
    for (const [a, b, g] of edges) {
      if (slot.has(a) && slot.has(b)) {
        out[slot.get(a)] -= g * x[slot.get(b)];
        out[slot.get(b)] -= g * x[slot.get(a)];
      }
    }
  };
  const x = new Float64Array(n);
  const r = Float64Array.from(rhs);
  const p = Float64Array.from(r);
  const q = new Float64Array(n);
  let rr = r.reduce((sum, v) => sum + v * v, 0);
  for (let it = 0; it < 4000 && rr > 1e-20; it++) {
    apply(p, q);
    const alpha = rr / p.reduce((sum, v, i) => sum + v * q[i], 0);
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * q[i];
    }
    const next = r.reduce((sum, v) => sum + v * v, 0);
    for (let i = 0; i < n; i++) {
      p[i] = r[i] + (next / rr) * p[i];
    }
    rr = next;
  }
  // Flow into the 0 side.
  let flow = 0;
  for (const [a, b, g] of edges) {
    const pa = slot.has(a) ? x[slot.get(a)] : fixed.get(a);
    const pb = slot.has(b) ? x[slot.get(b)] : fixed.get(b);
    if (fixed.get(b) === 0 && slot.has(a)) {
      flow += g * (pa - pb);
    } else if (fixed.get(a) === 0 && slot.has(b)) {
      flow += g * (pb - pa);
    }
  }
  return 1 / flow;
}

function mass1d(lo, hi) {
  const steps = 400;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const x = lo + ((i + 0.5) / steps) * (hi - lo);
    const index = Math.min(
      s.areas.length - 1,
      Math.floor((x / length) * s.areas.length)
    );
    sum += (hi - lo) / steps / s.areas[index];
  }
  return sum;
}

const rows = [];
for (const teeth of [null, s.teeth]) {
  solver.setShape(s.areas, 0, s.velumIndex, teeth);
  const row = [];
  for (let lo = 0.5; lo + window <= length - 0.25; lo += window) {
    const m3 = mass3d(lo, lo + window);
    row.push(
      `${lo.toFixed(1)}-${(lo + window).toFixed(1)}: ${mass1d(lo, lo + window).toFixed(2)}/${m3.toFixed(2)}`
    );
  }
  rows.push(`${teeth ? 'teeth   ' : 'no teeth'} ${row.join('  ')}`);
}
console.log(`/${symbol}/ dx ${dx} window ${window} cm, 1D/3D mass (1/cm)`);
console.log(rows.join('\n'));
