// Teeth voxels of the 3D model: how many cells are solid for each gap.
// Usage: node experiments/issue-5-teeth-voxels.mjs
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { planUtterance } from '../src/articulation/plan.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

for (const dx of [1, 0.8, 0.5]) {
  const model = buildVoxelModel(DEFAULT_HEAD, { dx });
  const solver = new Fdtd3d({ model, kernel: 'js' });
  const { teeth } = model;
  const slices = new Set(teeth.groups).size;
  console.log(
    `dx ${dx}: ${model.cells.length} cells, ${teeth.cells.length} teeth cells in ${slices} slices, edge ${teeth.edge.toFixed(2)}`
  );
  for (const text of ['ˈiː', 'ˈɑː', 'ˈasa']) {
    const plan = planUtterance(text);
    for (const segment of plan.segments.filter((s) => s.kind !== 'pause')) {
      const state = sampleState(plan, (segment.start + segment.end) / 2);
      const shape = tractShape(state, DEFAULT_HEAD);
      solver.setShape(shape.areas, shape.velumArea, 0, shape.teeth);
      const solid = Array.from(teeth.cells).filter((c) => solver.solid[c]);
      const zero = Array.from(solver.conductance).filter((g) => g === 0);
      console.log(
        `  ${text} ${segment.phoneme?.symbol ?? segment.kind}: gap ${shape.teeth.gap.toFixed(2)} solid ${solid.length}/${teeth.cells.length} closed links ${zero.length}`
      );
    }
  }
}
