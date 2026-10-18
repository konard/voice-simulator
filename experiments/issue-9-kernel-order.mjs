// Does link order or a gather (CSR) cell pass speed up the step loop?
// Plain JavaScript loops on the arrays of a real model; relative timings.
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 0.5);
const model = buildVoxelModel(normalizeHeadConfig({}), { dx });
const cells = model.cells.length;
const links = model.links.a.length;
const STEPS = 3000;
const now = () => globalThis.performance.now();

function scatter(linkA, linkB) {
  const p = new Float64Array(cells);
  const d = new Float64Array(cells);
  const v = new Float64Array(links);
  const g = new Float64Array(links).fill(0.9);
  p[0] = 1;
  const t = now();
  for (let s = 0; s < STEPS; s++) {
    for (let l = 0; l < links; l++) {
      const a = linkA[l];
      const b = linkB[l];
      const u = 0.999 * (v[l] - 0.5 * (p[b] - p[a]));
      v[l] = u;
      const f = g[l] * u;
      d[a] += f;
      d[b] -= f;
    }
    for (let c = 0; c < cells; c++) {
      p[c] = 0.9999 * p[c] - 0.5 * d[c];
      d[c] = 0;
    }
  }
  return [now() - t, p.reduce((x, y) => x + Math.abs(y), 0)];
}

function gather(linkA, linkB) {
  // Per cell: list of (link, sign).
  const start = new Int32Array(cells + 1);
  for (let l = 0; l < links; l++) {
    start[linkA[l] + 1]++;
    start[linkB[l] + 1]++;
  }
  for (let c = 0; c < cells; c++) {
    start[c + 1] += start[c];
  }
  const fill = start.slice();
  const incident = new Int32Array(2 * links);
  const sign = new Float64Array(2 * links);
  for (let l = 0; l < links; l++) {
    incident[fill[linkA[l]]] = l;
    sign[fill[linkA[l]]++] = 1;
    incident[fill[linkB[l]]] = l;
    sign[fill[linkB[l]]++] = -1;
  }
  const p = new Float64Array(cells);
  const v = new Float64Array(links);
  const flux = new Float64Array(links);
  const g = new Float64Array(links).fill(0.9);
  p[0] = 1;
  const t = now();
  for (let s = 0; s < STEPS; s++) {
    for (let l = 0; l < links; l++) {
      const u = 0.999 * (v[l] - 0.5 * (p[linkB[l]] - p[linkA[l]]));
      v[l] = u;
      flux[l] = g[l] * u;
    }
    for (let c = 0; c < cells; c++) {
      let d = 0;
      for (let k = start[c]; k < start[c + 1]; k++) {
        d += sign[k] * flux[incident[k]];
      }
      p[c] = 0.9999 * p[c] - 0.5 * d;
    }
  }
  return [now() - t, p.reduce((x, y) => x + Math.abs(y), 0)];
}

const order = [...Array(links).keys()];
const sorted = order.slice().sort((x, y) => {
  const ax = Math.min(model.links.a[x], model.links.b[x]);
  const ay = Math.min(model.links.a[y], model.links.b[y]);
  return (
    ax - ay ||
    Math.max(model.links.a[x], model.links.b[x]) -
      Math.max(model.links.a[y], model.links.b[y])
  );
});
const A = Int32Array.from(model.links.a);
const B = Int32Array.from(model.links.b);
const As = Int32Array.from(sorted, (l) => A[l]);
const Bs = Int32Array.from(sorted, (l) => B[l]);
let jumps = 0;
for (let l = 1; l < links; l++) {
  jumps += Math.abs(A[l] - A[l - 1]);
}
console.log(
  `dx ${dx}: ${cells} cells, ${links} links, mean |a jump| ${(jumps / links).toFixed(1)}`
);
for (let r = 0; r < 2; r++) {
  for (const [name, f] of [
    ['scatter, model order', () => scatter(A, B)],
    ['scatter, sorted', () => scatter(As, Bs)],
    ['gather, model order', () => gather(A, B)],
    ['gather, sorted', () => gather(As, Bs)],
  ]) {
    const [ms] = f();
    console.log(
      `  ${name}: ${((ms * 1e6) / STEPS / (links + cells)).toFixed(2)} ns per update`
    );
  }
}
