// Head extents and voxel model sizes (used to size the fdtd enclosure).
import { headMesh } from '../src/geometry/mesh.js';
import { headLandmarks } from '../src/geometry/centerline.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';

const mesh = headMesh({}, { lod: 2 });
const low = [Infinity, Infinity, Infinity];
const high = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < mesh.positions.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    low[a] = Math.min(low[a], mesh.positions[i + a]);
    high[a] = Math.max(high[a], mesh.positions[i + a]);
  }
}
console.log(
  'head low',
  low.map((v) => v.toFixed(1)),
  'high',
  high.map((v) => v.toFixed(1))
);
console.log('landmarks', headLandmarks({}));
for (const dx of [1, 0.6]) {
  const began = globalThis.performance.now();
  const model = buildVoxelModel({}, { dx });
  console.log(
    `dx ${dx}: ${model.cells.length} cells, ${model.links.a.length} links, ${(globalThis.performance.now() - began).toFixed(0)} ms`
  );
}
