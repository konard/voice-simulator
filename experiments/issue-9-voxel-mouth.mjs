/**
 * Voxel cells around the mouth: how wide and how far forward the tract
 * cells reach and how many cells each tube has.
 * Usage: node experiments/issue-9-voxel-mouth.mjs [dx] [preset]
 */
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { headLandmarks } from '../src/geometry/centerline.js';
import { presetHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 1);
const head = presetHeadConfig(process.argv[3] ?? 'male');
const model = buildVoxelModel(head, { dx });
const { lips } = headLandmarks(head);
const counts = {};
for (const cell of model.cells) {
  counts[cell.kind] = (counts[cell.kind] ?? 0) + 1;
}
const front = model.cells.filter(
  (cell) => cell.kind === 0 && cell.point[2] > lips[2] - 1.5
);
const extent = (axis) =>
  front.length
    ? [
        Math.min(...front.map((c) => c.point[axis])),
        Math.max(...front.map((c) => c.point[axis])),
      ]
        .map((v) => v.toFixed(2))
        .join('..')
    : '-';
console.log('cells by kind', JSON.stringify(counts));
console.log('lips', lips.map((v) => v.toFixed(2)).join(','));
console.log(
  'tract cells within 1.5 cm of the lips',
  front.length,
  'x',
  extent(0),
  'y',
  extent(1),
  'z',
  extent(2)
);
