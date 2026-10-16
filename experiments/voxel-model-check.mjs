// Build the sparse voxel model at several resolutions and report sizes.
import { performance } from 'node:perf_hooks';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

for (const dx of [1, 0.8, 0.6, 0.5]) {
  const start = performance.now();
  const model = buildVoxelModel(DEFAULT_HEAD, { dx });
  const counts = [0, 0, 0];
  for (const cell of model.cells) {
    counts[cell.kind]++;
  }
  const kinds = [0, 0, 0, 0];
  for (const kind of model.links.kind) {
    kinds[kind]++;
  }
  console.log(
    `dx ${dx}: cells tract ${counts[0]} nose ${counts[1]} air ${counts[2]},` +
      ` links inner ${kinds[0]} lips ${kinds[1]} nostrils ${kinds[2]}` +
      ` velum ${kinds[3]}, open faces ${model.openFaces.reduce((a, b) => a + b, 0)},` +
      ` build ${(performance.now() - start).toFixed(0)} ms`
  );
}
