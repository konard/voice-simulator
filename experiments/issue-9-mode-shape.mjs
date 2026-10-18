/**
 * Where a 3D resonance lives: DFT of every cell's pressure at one
 * frequency after an impulse, summed by cell kind and arc.
 * Args: [dx] [vowel] [frequency] [piriform 0|1]
 */
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { noseShape, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const dx = Number(process.argv[2] ?? 1);
const vowel = process.argv[3] ?? 'ə';
const frequency = Number(process.argv[4] ?? 420);
const piriform = process.argv[5] === '1';
const model = buildVoxelModel(DEFAULT_HEAD, { dx, piriform, vallecula: false });
const shape = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme(vowel) }), rhotic: 0 },
  DEFAULT_HEAD
);
const s = new Fdtd3d({ model });
s.setNose(noseShape(DEFAULT_HEAD).areas);
s.setShape(shape.areas, 0);
const dt = s.stepDuration(shape);
const steps = Math.round(0.06 / dt);
const n = model.cells.length;
const re = new Float64Array(n);
const im = new Float64Array(n);
for (let t = 0; t < steps; t++) {
  s.step(t === 0 ? 1 : 0, 0, 0);
  const w = 2 * Math.PI * frequency * t * dt;
  const c = Math.cos(w),
    sn = Math.sin(w);
  for (let i = 0; i < n; i++) {
    re[i] += s.pressure[i] * c;
    im[i] -= s.pressure[i] * sn;
  }
}
const groups = new Map();
model.cells.forEach((cell, i) => {
  const key = `${cell.kind}:${cell.tube ?? ''}:${Math.floor(cell.arc ?? -1)}`;
  const g = groups.get(key) ?? { energy: 0, count: 0, re: 0 };
  g.energy += (re[i] ** 2 + im[i] ** 2) * s.fill[i];
  g.re += re[i];
  g.count++;
  groups.set(key, g);
});
const total = [...groups.values()].reduce((a, g) => a + g.energy, 0);
for (const [key, g] of [...groups]
  .sort((a, b) => b[1].energy - a[1].energy)
  .slice(0, 25)) {
  console.log(
    key.padEnd(14),
    (g.energy / total).toFixed(3),
    'cells',
    g.count,
    'mean re',
    (g.re / g.count).toExponential(2)
  );
}
