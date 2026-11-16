// Runs benchmarkDevice a few times in one process on each engine and prints
// the wall time, CPU seconds, longest slice, loads and the chosen tier.
// Usage: node experiments/issue-28-device-benchmark.mjs [runs]
import { benchmarkDevice } from '../src/perf/device-benchmark.js';
import { AUDIO_TIERS } from '../src/perf/lod.js';

const runs = Number(process.argv[2] ?? 3);
for (const engine of ['js', 'auto']) {
  for (let run = 1; run <= runs; run++) {
    const began = globalThis.performance.now();
    const result = await benchmarkDevice({ engine });
    const wall = (globalThis.performance.now() - began) / 1000;
    const loads = result.loads
      .map(
        (load, i) =>
          `${AUDIO_TIERS[i].name}=${load.toFixed(3)}${result.measured[i] ? '' : '*'}`
      )
      .join(' ');
    console.log(
      `${engine}(${result.engine.name}) run ${run}: wall ${wall.toFixed(3)} s, cpu ${result.cpuSeconds.toFixed(3)} s, longest slice ${(1000 * result.longestSlice).toFixed(1)} ms, level ${result.tier.name}`
    );
    console.log(`  ${loads}  (* predicted)`);
  }
}
