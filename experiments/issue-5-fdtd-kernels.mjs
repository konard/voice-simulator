// Microbenchmark of FDTD step-kernel variants on the real voxel model.
// Usage: node experiments/issue-5-fdtd-kernels.mjs [dx] [steps]
import { buildVoxelModel, DEFAULT_HEAD } from '../src/index.js';

const dx = Number(process.argv[2] ?? 0.6);
const steps = Number(process.argv[3] ?? 50000);
const model = buildVoxelModel(DEFAULT_HEAD, { dx });
const cellCount = model.cells.length;
const linkA = Int32Array.from(model.links.a);
const linkB = Int32Array.from(model.links.b);
const linkCount = linkA.length;
const kinds = model.cells.map((c) => c.kind);
console.log({
  dx,
  cellCount,
  linkCount,
  air: kinds.filter((k) => k === 2).length,
});
const C = 0.5;
const damping = new Float64Array(linkCount).fill(0.999);
const conductance = new Float64Array(linkCount).fill(0.8);
const keep = new Float64Array(cellCount).fill(0.99);
const gain = new Float64Array(cellCount).fill(0.6);

function separate(p, v, div) {
  for (let l = 0; l < linkCount; l++) {
    const a = linkA[l];
    const b = linkB[l];
    const u = damping[l] * (v[l] - C * (p[b] - p[a]));
    v[l] = u;
    const f = conductance[l] * u;
    div[a] += f;
    div[b] -= f;
  }
  for (let i = 0; i < cellCount; i++) {
    p[i] = keep[i] * p[i] - gain[i] * div[i];
    div[i] = 0;
  }
}
const linkEnd = new Int32Array(cellCount);
{
  let l = 0;
  for (let c = 0; c < cellCount; c++) {
    while (l < linkCount && linkA[l] === c) {
      l++;
    }
    linkEnd[c] = l;
  }
}
function fused(p, v, div) {
  let l = 0;
  for (let c = 0; c < cellCount; c++) {
    const end = linkEnd[c];
    const own = p[c];
    let sum = div[c];
    for (; l < end; l++) {
      const b = linkB[l];
      const u = damping[l] * (v[l] - C * (p[b] - own));
      v[l] = u;
      const f = conductance[l] * u;
      sum += f;
      div[b] -= f;
    }
    p[c] = keep[c] * own - gain[c] * sum;
    div[c] = 0;
  }
}
// Float32 storage variant (not bit identical).
const damping32 = new Float32Array(damping);
const conductance32 = new Float32Array(conductance);
const keep32 = new Float32Array(keep);
const gain32 = new Float32Array(gain);
function fused32(p, v, div) {
  let l = 0;
  for (let c = 0; c < cellCount; c++) {
    const end = linkEnd[c];
    const own = p[c];
    let sum = div[c];
    for (; l < end; l++) {
      const b = linkB[l];
      const u = damping32[l] * (v[l] - C * (p[b] - own));
      v[l] = u;
      const f = conductance32[l] * u;
      sum += f;
      div[b] -= f;
    }
    p[c] = keep32[c] * own - gain32[c] * sum;
    div[c] = 0;
  }
}
function run(name, kernel, Arr = Float64Array) {
  const p = new Arr(cellCount);
  const v = new Arr(linkCount);
  const div = new Arr(cellCount);
  for (let s = 0; s < 2000; s++) {
    p[0] += s % 100 === 0 ? 1 : 0;
    kernel(p, v, div);
  }
  const t = globalThis.performance.now();
  for (let s = 0; s < steps; s++) {
    p[0] += Math.sin(s * 0.01);
    kernel(p, v, div);
  }
  const ms = globalThis.performance.now() - t;
  console.log(
    name,
    ms.toFixed(1),
    'ms',
    ((ms * 1e6) / steps / linkCount).toFixed(2),
    'ns/link',
    p[5]
  );
}
for (let r = 0; r < 2; r++) {
  run('separate', separate);
  run('fused', fused);
  run('fused32', fused32, Float32Array);
}
