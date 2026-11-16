// Time to build the voxel model of the 3D tiers (worker-protocol.js caches
// it per head): the stall when a stream first switches up into `high`.
import {
  buildVoxelModel,
  voxelModelOptions,
} from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/index.js';
import { AUDIO_TIERS } from '../src/perf/lod.js';

for (const tier of AUDIO_TIERS.filter((entry) => entry.solver === 'fdtd3d')) {
  const began = globalThis.performance.now();
  const model = buildVoxelModel(
    DEFAULT_HEAD,
    voxelModelOptions({ dx: tier.dx })
  );
  const ms = globalThis.performance.now() - began;
  console.log(
    tier.name,
    `dx ${tier.dx}`,
    `${model.cells.length} cells`,
    `${ms.toFixed(0)} ms`
  );
}
