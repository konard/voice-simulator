// Lip mesh check: signed volume (positive = faces outward), opening size
// and extents of the lips for a few vowels, beside the other closed lofts.
// Usage: node experiments/issue-9-lips.mjs
import { anatomyMeshes } from '../src/geometry/anatomy.js';
import { lipsMesh } from '../src/geometry/lips.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

function signedVolume({ positions, indices }) {
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) =>
      positions.subarray(indices[i + k] * 3, indices[i + k] * 3 + 3)
    );
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return volume;
}

function extent(positions, axis) {
  let low = Infinity;
  let high = -Infinity;
  for (let i = axis; i < positions.length; i += 3) {
    low = Math.min(low, positions[i]);
    high = Math.max(high, positions[i]);
  }
  return `${low.toFixed(2)}..${high.toFixed(2)}`;
}

for (const mesh of anatomyMeshes(DEFAULT_HEAD, { lod: 2 })) {
  console.log(mesh.name, 'volume', signedVolume(mesh).toFixed(2));
}
for (const [label, area, rounding] of [
  ['rest', 1.4, 0],
  ['closed', 0, 0],
  ['/a/', 5, 0],
  ['/u/', 0.3, 1],
]) {
  const mesh = lipsMesh(DEFAULT_HEAD, { area, rounding, lod: 2 });
  const half = mesh.positions.length / 2;
  const upper = { positions: mesh.positions.subarray(0, half) };
  console.log(
    label,
    'volume',
    signedVolume(mesh).toFixed(2),
    'x',
    extent(mesh.positions, 0),
    'y',
    extent(mesh.positions, 1),
    'z',
    extent(mesh.positions, 2),
    'upper y',
    extent(upper.positions, 1)
  );
}
