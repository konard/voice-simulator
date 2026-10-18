// Centreline (medial path through the voxelised tract) and area function
// of Dresden Vocal Tract Dataset inner surfaces.
// Usage: node experiments/issue-9-dvtd-area-function.mjs <stl>...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseStl } from '../src/geometry/stl.js';
import { areaFunction, tractOpenings } from '../src/geometry/tract-analysis.js';
import {
  capLoops,
  medialPath,
  voxelizeMesh,
  wallDistance,
} from '../src/geometry/voxelize.js';

for (const file of process.argv.slice(2)) {
  const started = globalThis.performance.now();
  const mesh = parseStl(readFileSync(file));
  const openings = tractOpenings(mesh, [0, 0, 1]);
  const grid = voxelizeMesh(capLoops(mesh), { dx: 1 });
  const inside = grid.inside.reduce((sum, value) => sum + value, 0);
  const distance = wallDistance(grid);
  const path = medialPath(
    grid,
    distance,
    openings.glottis.center,
    openings.lips.center
  );
  path.unshift(openings.glottis.center);
  path.push(openings.lips.center);
  const result = areaFunction(mesh, path, { step: 2.5, window: 7 });
  const volume =
    result.areas.reduce((sum, area) => sum + area, 0) *
    (result.length / (result.areas.length + 1));
  console.log(
    `${basename(file)}: voxels ${inside} (${(inside / 1000).toFixed(1)} cm³), area-function volume ${(volume / 1000).toFixed(1)} cm³, length ${(result.length / 10).toFixed(2)} cm, ${result.areas.length} sections, ${((globalThis.performance.now() - started) / 1000).toFixed(1)} s`
  );
  console.log(
    `  areas cm²: ${result.areas.map((a) => (a / 100).toFixed(2)).join(' ')}`
  );
  console.log(
    `  centre y,z: ${result.points
      .filter((_, i) => i % 4 === 0)
      .map((p) => `${p[1].toFixed(0)},${p[2].toFixed(0)}`)
      .join(' ')}`
  );
}
