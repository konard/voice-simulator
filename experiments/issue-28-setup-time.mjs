// Time to build the voxel model and create the renderer of the 3D tier
// `high`, three times in one process (the first is cold).
// Usage: node experiments/issue-28-setup-time.mjs [js|auto]
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { benchmarkRenderer } from '../src/perf/benchmark.js';
import { AUDIO_TIERS, audioTierIndex } from '../src/perf/lod.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';
import { createEngine } from '../src/engine/index.js';

const engine = await createEngine(process.argv[2] ?? 'js');
const tier = AUDIO_TIERS[audioTierIndex('high')];
const head = normalizeHeadConfig(DEFAULT_HEAD);
for (let run = 1; run <= 3; run++) {
  let t = performance.now();
  buildVoxelModel(head, { dx: tier.dx });
  const model = performance.now() - t;
  t = performance.now();
  const renderer = benchmarkRenderer(tier, { seconds: 0.06, engine });
  const create = performance.now() - t;
  renderer.free?.();
  console.log(
    `${engine.name} run ${run}: voxel model ${model.toFixed(1)} ms, model + renderer ${create.toFixed(1)} ms`
  );
}
