// Midsagittal bend angle, lateral width and wall offsets along the hosted
// Dresden Vocal Tract Dataset tracts, in the head frame.
// Usage: node experiments/issue-9-tract-profiles.mjs
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DVTD_TO_HEAD, transformPoint } from '../src/geometry/align.js';
import { tractAreaFunction } from '../src/geometry/dvtd.js';
import { parseStl } from '../src/geometry/stl.js';
import { crossSection } from '../src/geometry/tract-analysis.js';

const fixtures = new globalThis.URL('../tests/fixtures/dvtd/', import.meta.url);
const manifest = JSON.parse(
  readFileSync(new globalThis.URL('manifest.json', fixtures))
);
const turn = { ...DVTD_TO_HEAD, scale: 1 };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
for (const entry of manifest.files) {
  const mesh = parseStl(
    gunzipSync(readFileSync(new globalThis.URL(entry.file, fixtures)))
  );
  const r = tractAreaFunction(mesh);
  const rows = [];
  r.points.forEach((point, i) => {
    const t = transformPoint(r.directions[i], turn);
    const theta = (Math.atan2(t[2], t[1]) * 180) / Math.PI;
    const section = crossSection(mesh, point, r.directions[i]);
    const side = [1, 0, 0];
    const normal = cross(t, side);
    const n = Math.hypot(...normal);
    const nn = normal.map((v) => v / n);
    const c = transformPoint(point, turn);
    let [wmin, wmax, umin, umax] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of section.points) {
      const q = transformPoint(p, turn).map((v, k) => v - c[k]);
      const w = dot(q, side);
      const u = dot(q, nn);
      wmin = Math.min(wmin, w);
      wmax = Math.max(wmax, w);
      umin = Math.min(umin, u);
      umax = Math.max(umax, u);
    }
    rows.push([
      r.distances[i] / r.length,
      theta,
      (wmax - wmin) / 10,
      umax / 10,
      -umin / 10,
      r.areas[i] / 100,
      c[0] / 10,
    ]);
  });
  console.log(`\n${entry.file} length ${(r.length / 10).toFixed(2)} cm`);
  console.log('t theta width upper lower area x');
  for (const row of rows.filter((_, i) => i % 3 === 0)) {
    console.log(row.map((v) => v.toFixed(2)).join(' '));
  }
}
