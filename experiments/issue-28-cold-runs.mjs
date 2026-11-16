// One cold benchmarkDevice run per process: prints cpuSeconds, wall time,
// the longest slice and which tiers were measured.
// Usage: for i in $(seq 10); do node experiments/issue-28-cold-runs.mjs js; done
import { benchmarkDevice } from '../src/perf/device-benchmark.js';
import { AUDIO_TIERS } from '../src/perf/lod.js';

const began = performance.now();
const result = await benchmarkDevice({ engine: process.argv[2] ?? 'js' });
const wall = (performance.now() - began) / 1000;
const ran = AUDIO_TIERS.filter((_, i) => result.measured[i]).map((t) => t.name);
console.log(
  `${result.engine.name} cpu ${result.cpuSeconds.toFixed(3)} s wall ${wall.toFixed(3)} s longest ${(1000 * result.longestSlice).toFixed(0)} ms level ${result.tier.name} measured ${ran.join(',')}`
);
