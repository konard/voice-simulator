// Checks fill fractions, conductances and output of the 3D solver for NaN.
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 1);
const solver = new Fdtd3d({ dx, kernel: 'js' });
const shape = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(process.env.VOWEL ?? 'ɑ') }) },
  normalizeHeadConfig({})
);
solver.setShape(
  shape.areas,
  0,
  shape.velumIndex,
  process.argv[3] ? shape.teeth : null
);
const bad = (array) =>
  Array.from(array).findIndex((value) => !Number.isFinite(value));
console.log(
  'fill',
  bad(solver.fill),
  'conductance',
  bad(solver.conductance),
  'damping',
  bad(solver.damping),
  'gain',
  bad(solver.gain),
  'envelope',
  bad(solver.envelope),
  'above',
  solver.above && bad(solver.above)
);
const out = [];
for (let n = 0; n < 2000; n++) {
  out.push(solver.step(n === 0 ? 1 : 0, 0, 0));
}
console.log(
  'first bad output',
  bad(out),
  'max',
  Math.max(...out.map(Math.abs))
);
const cell = solver.model.cells[34];
console.log(
  cell,
  solver.envelope[34],
  solver.effective[34],
  solver.above?.[34],
  solver.teethCell[34],
  solver.teethGap
);
// Reachability through links with conductance > 0 from the source cells.
const reach = new Uint8Array(solver.cellCount);
const queue = [...solver.sourceCells];
queue.forEach((c) => (reach[c] = 1));
const adjacency = Array.from({ length: solver.cellCount }, () => []);
for (let l = 0; l < solver.linkCount; l++) {
  if (solver.conductance[l] > 1e-6) {
    adjacency[solver.linkA[l]].push(solver.linkB[l]);
    adjacency[solver.linkB[l]].push(solver.linkA[l]);
  }
}
while (queue.length) {
  const c = queue.pop();
  for (const n of adjacency[c]) {
    if (!reach[n]) {
      reach[n] = 1;
      queue.push(n);
    }
  }
}
const slices = new Map();
solver.model.cells.forEach((cell, i) => {
  if (cell.kind !== 0) {
    return;
  }
  const k = Math.round(cell.arc / dx);
  const s = slices.get(k) ?? { n: 0, open: 0, reached: 0, maxFill: 0 };
  s.n++;
  s.open += solver.fill[i] * dx * dx;
  s.reached += reach[i];
  s.maxFill = Math.max(s.maxFill, solver.fill[i]);
  slices.set(k, s);
});
for (const [k, s] of [...slices].sort((a, b) => a[0] - b[0])) {
  const area =
    shape.areas[Math.min(43, Math.floor(((k * dx) / shape.length) * 44))];
  console.log(
    k * dx,
    s.n,
    'open',
    s.open.toFixed(2),
    'area',
    area.toFixed(2),
    'reached',
    s.reached,
    'maxFill',
    s.maxFill.toFixed(2)
  );
}
console.log(
  'source cells',
  solver.sourceCells.length,
  'output links reached',
  Array.from(solver.outputLinks).filter(
    (l) => reach[solver.linkA[l]] || reach[solver.linkB[l]]
  ).length,
  'of',
  solver.outputLinks.length
);
// Open cells (fill > 1e-3) of the slices named in argv[4] ("7,8,9").
for (const k of (process.argv[4] ?? '')
  .split(',')
  .filter(Boolean)
  .map(Number)) {
  solver.model.cells.forEach((cell, i) => {
    if (
      cell.kind === 0 &&
      Math.round(cell.arc / dx) === k &&
      solver.fill[i] > 1e-3
    ) {
      console.log(
        k,
        i,
        cell.point.map((v) => v.toFixed(1)).join(','),
        'arc',
        cell.arc.toFixed(2),
        'fill',
        solver.fill[i].toFixed(2),
        'reach',
        reach[i]
      );
    }
  });
}
// Widest path: the largest bottleneck conductance from the source to each cell.
const width = new Float64Array(solver.cellCount);
const via = new Int32Array(solver.cellCount).fill(-1);
const links = Array.from({ length: solver.cellCount }, () => []);
for (let l = 0; l < solver.linkCount; l++) {
  links[solver.linkA[l]].push(l);
  links[solver.linkB[l]].push(l);
}
const done = new Uint8Array(solver.cellCount);
solver.sourceCells.forEach((c) => (width[c] = Infinity));
for (;;) {
  let best = -1;
  for (let c = 0; c < solver.cellCount; c++) {
    if (!done[c] && width[c] > 0 && (best < 0 || width[c] > width[best])) {
      best = c;
    }
  }
  if (best < 0) {
    break;
  }
  done[best] = 1;
  for (const l of links[best]) {
    const other = solver.linkA[l] === best ? solver.linkB[l] : solver.linkA[l];
    const w = Math.min(width[best], solver.conductance[l]);
    if (w > width[other]) {
      width[other] = w;
      via[other] = l;
    }
  }
}
const lipsWidth = Math.max(
  ...Array.from(solver.outputLinks).map((l) =>
    Math.max(width[solver.linkA[l]], width[solver.linkB[l]])
  )
);
console.log('widest path to the lips', lipsWidth);
// Walk the widest path back from the lips and print its narrowest links.
let at = -1;
for (const l of solver.outputLinks) {
  for (const c of [solver.linkA[l], solver.linkB[l]]) {
    if (at < 0 || width[c] > width[at]) {
      at = c;
    }
  }
}
const path = [];
while (via[at] >= 0) {
  const l = via[at];
  path.push(l);
  at = solver.linkA[l] === at ? solver.linkB[l] : solver.linkA[l];
}
const describe = (c) => {
  const cell = solver.model.cells[c];
  return `${c} k${cell.kind} (${cell.point.map((v) => v.toFixed(2)).join(',')}) arc ${cell.arc.toFixed(2)} fill ${solver.fill[c].toFixed(4)} area ${solver.cellArea[c].toFixed(2)}`;
};
for (const l of path.filter((l) => solver.conductance[l] < lipsWidth * 3)) {
  console.log(
    'narrow link g',
    solver.conductance[l].toExponential(2),
    '|',
    describe(solver.linkA[l]),
    '|',
    describe(solver.linkB[l])
  );
}
