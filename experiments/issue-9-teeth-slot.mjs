/**
 * Open area of each incisor slice against the slot area between the
 * incisal edges, per grid size and vowel.
 * Usage: node experiments/issue-9-teeth-slot.mjs
 */
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

for (const dx of [1, 0.5]) {
  const grid = buildVoxelModel(DEFAULT_HEAD, { dx });
  const solver = new Fdtd3d({ model: grid, kernel: 'js' });
  console.log(
    'dx',
    dx,
    'edge',
    grid.teeth.edge.toFixed(2),
    'centre',
    grid.teeth.centre.toFixed(2)
  );
  for (const symbol of ['i', 'ə', 'ɑ']) {
    const shape = tractShape(
      { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
      DEFAULT_HEAD
    );
    solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
    const slot = shape.teeth.gap * grid.teeth.width;
    const open = new Map();
    const ys = new Map();
    grid.teeth.cells.forEach((cell, position) => {
      const group = grid.teeth.groups[position];
      open.set(group, (open.get(group) ?? 0) + solver.openness[cell] * dx * dx);
      const y = grid.cells[cell].point[1];
      const range = ys.get(group) ?? [Infinity, -Infinity];
      ys.set(group, [Math.min(range[0], y), Math.max(range[1], y)]);
    });
    console.log(
      ' ',
      symbol,
      'gap',
      shape.teeth.gap.toFixed(2),
      'slot',
      slot.toFixed(2),
      [...open]
        .map(
          ([g, a]) =>
            `${g}:${a.toFixed(2)} y${ys
              .get(g)
              .map((v) => v.toFixed(1))
              .join('..')}`
        )
        .join(' ')
    );
  }
}
