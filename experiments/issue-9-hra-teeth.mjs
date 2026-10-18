// Split the HuBMAP reference-organ tooth sets into connected shells and
// print their sizes and centres (mm, head frame).
// Usage: node experiments/issue-9-hra-teeth.mjs <mouth.glb>
import { readFileSync } from 'node:fs';
import { readGlbMeshes } from '../src/geometry/gltf-read.js';

const [file] = process.argv.slice(2);
const meshes = readGlbMeshes(new Uint8Array(readFileSync(file)), {
  names: (name) => name.includes('jaw_teeth'),
  scale: 1000,
});

function components({ positions, indices }) {
  const count = positions.length / 3;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]);
    for (const c of [indices[t + 1], indices[t + 2]]) {
      const b = find(c);
      if (a !== b) {
        parent[b] = a;
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root).push(i);
  }
  return [...groups.values()];
}

for (const mesh of meshes) {
  const groups = components(mesh).sort((a, b) => b.length - a.length);
  console.log(
    mesh.name,
    'vertices',
    mesh.positions.length / 3,
    'shells',
    groups.length
  );
  for (const group of groups.slice(0, 24)) {
    const c = [0, 1, 2].map(
      (axis) =>
        group.reduce((s, i) => s + mesh.positions[i * 3 + axis], 0) /
        group.length
    );
    const ext = [0, 1, 2].map((axis) => {
      const v = group.map((i) => mesh.positions[i * 3 + axis]);
      return Math.max(...v) - Math.min(...v);
    });
    console.log(
      `  ${String(group.length).padStart(6)} centre ${c.map((v) => v.toFixed(1)).join(',')} size ${ext.map((v) => v.toFixed(1)).join(',')}`
    );
  }
}
