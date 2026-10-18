/**
 * Summary of the default head's voxel model at a microphone shell: cells
 * per kind, the forward reach of the tract against the lips, the tract
 * cells in the lip plane and the open faces of the air shell.
 * Usage: node experiments/issue-9-voxel-summary.mjs [dx] [radius]
 */
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';

const dx = Number(process.argv[2] ?? 1);
const radiationRadius = Number(process.argv[3] ?? 5);
const model = buildVoxelModel(undefined, { dx, radiationRadius });
const counts = {};
for (const cell of model.cells) {
  counts[cell.kind] = (counts[cell.kind] ?? 0) + 1;
}
const { lips } = model.landmarks;
const tract = model.cells.filter((cell) => cell.kind === 0);
const frontZ = Math.max(...tract.map((cell) => cell.point[2]));
const lipCells = tract.filter((cell) => cell.point[2] > frontZ - dx / 2);
const links = {};
for (const kind of model.links.kind) {
  links[kind] = (links[kind] ?? 0) + 1;
}
console.log('cells', JSON.stringify(counts), 'links', JSON.stringify(links));
console.log(
  'lips',
  lips.map((v) => v.toFixed(2)).join(','),
  'tract front z',
  frontZ.toFixed(2)
);
console.log(
  'front slice',
  lipCells
    .map((cell) => cell.point.map((v) => v.toFixed(1)).join(','))
    .join(' | ')
);
console.log(
  'open faces',
  model.openFaces.reduce((sum, value) => sum + value, 0)
);
