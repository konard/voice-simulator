// Time each stage of the DVTD area-function extraction.
// Usage: node experiments/issue-9-dvtd-timing.mjs <inner-surface.stl>
import { readFileSync } from 'node:fs';
import { parseStl } from '../src/geometry/stl.js';
import { areaFunction, tractOpenings } from '../src/geometry/tract-analysis.js';
import {
  capLoops,
  medialPath,
  voxelizeMesh,
  wallDistance,
} from '../src/geometry/voxelize.js';

const now = () => globalThis.performance.now();
let last = now();
const lap = (label) => {
  const t = now();
  console.log(`${label}: ${(t - last).toFixed(0)} ms`);
  last = t;
};
const mesh = parseStl(readFileSync(process.argv[2]));
lap(`parse (${mesh.indices.length / 3} triangles)`);
const openings = tractOpenings(mesh, [0, 0, 1]);
lap('openings');
const grid = voxelizeMesh(capLoops(mesh), { dx: 1 });
lap(`voxelize (${grid.size.join('x')})`);
const distance = wallDistance(grid);
lap('wall distance');
const path = medialPath(
  grid,
  distance,
  openings.glottis.center,
  openings.lips.center
);
lap('medial path');
const result = areaFunction(
  mesh,
  [openings.glottis.center, ...path, openings.lips.center],
  { step: 2.5, window: 7 }
);
lap(`area function (${result.areas.length} sections)`);
