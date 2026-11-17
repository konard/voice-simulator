/** Diagnose the bounded, coarse 3D feature probe; no full tier benchmark. */
import { Session } from 'node:inspector';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createEngine, ENGINE_FEATURES } from '../src/index.js';
import { prepareProbe } from '../tests/helpers/engine-features.js';

const feature = ENGINE_FEATURES.find(({ id }) => id === 'solver.fdtd3d');
const { plan, renderOptions } = prepareProbe(feature);
const profile = process.argv.includes('--profile') ? new Session() : null;
if (profile) {
  profile.connect();
  await profile.post('Profiler.enable');
  await profile.post('Profiler.start');
}
for (const name of ['js', 'rust']) {
  const engine = await createEngine({ engine: name, threads: 1, simd: false });
  let initialize = 0;
  if (name === 'rust') {
    const exports = engine.module.exports;
    engine.module = {
      ...engine.module,
      exports: {
        ...exports,
        vs_renderer_new(...args) {
          const start = performance.now();
          const result = exports.vs_renderer_new(...args);
          initialize = performance.now() - start;
          return result;
        },
      },
    };
  }
  const rows = [];
  for (let run = 0; run < 10; run++) {
    const start = performance.now();
    const renderer = engine.createRenderer(plan, renderOptions);
    const constructed = performance.now();
    const samples = new Float32Array(renderer.totalSamples);
    renderer.render(samples);
    const finished = performance.now();
    if (run >= 2) {
      rows.push({
        construction: constructed - start,
        render: finished - constructed,
        frames: renderer.prepareTime ?? null,
        initialize: name === 'rust' ? initialize : null,
      });
    }
    if (!samples.every(Number.isFinite)) {
      throw new Error(`${name}: non-finite samples`);
    }
    renderer.free?.();
  }
  console.log(name, JSON.stringify(rows));
}
if (profile) {
  const { profile: result } = await new Promise((resolve, reject) =>
    profile.post('Profiler.stop', (error, data) =>
      error ? reject(error) : resolve(data)
    )
  );
  mkdirSync('experiments/out', { recursive: true });
  writeFileSync(
    'experiments/out/issue-82-fdtd.cpuprofile',
    JSON.stringify(result)
  );
  profile.disconnect();
}
