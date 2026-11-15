// Issue 23: which voxel-model fields fdtd3d.js reads and their value ranges.
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const model = buildVoxelModel(DEFAULT_HEAD, { dx: 1 });
const tubes = new Map();
for (const cell of model.cells) {
  const key = `${cell.kind}:${cell.tube}`;
  tubes.set(key, (tubes.get(key) ?? 0) + 1);
}
console.log('kind:tube counts', Object.fromEntries(tubes));
const rowsUsed = new Set();
const { cellWeights, per } = model.opening;
for (let cell = 0; cell < model.cells.length; cell++) {
  for (let k = 0; k < per; k++) {
    if (cellWeights[cell * per + k] !== 0) {
      rowsUsed.add(model.cells[cell].kind);
    }
  }
}
console.log('kinds with nonzero opening rows', [...rowsUsed]);
console.log('openFaces max', Math.max(...model.openFaces));
console.log('sinuses', model.sinuses);
const shape = tractShape({ phoneme: getPhoneme('a') }, DEFAULT_HEAD);
console.log('teeth of a shape', shape.teeth, 'length', shape.length);
