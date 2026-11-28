/** Sample the full recognition path under the certification heap cap. Unlicense. */
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { cpuUsage } from 'node:process';
import { resample } from '../src/audio/resample.js';
import { recognize, synthesize } from '../src/index.js';
import { loadEngine } from '../scripts/lowest-rows.mjs';
import { BENCHMARK, loadBenchmark } from '../tests/heavy/helpers/benchmark.js';

const [engine = 'js', limit = '2', profilePath] = process.argv.slice(2);
const count = Number(limit);
if (!Number.isInteger(count) || count < 1 || count > 10) {
  throw new RangeError('Select from one to ten recordings per dataset');
}
const selected = await loadEngine(engine);
if (selected.unavailable) {
  throw new Error(selected.unavailable);
}
const options = { level: 'low', engine: selected.recognition };
const warm = synthesize('Hello world.', { tier: 'telephone', seed: 1 });
recognize(warm.samples, warm.sampleRate, options);
const profiler = new Session();
if (profilePath) {
  profiler.connect();
  await profiler.post('Profiler.enable');
  await profiler.post('Profiler.start');
}
const rate = 8000;
let audio = 0;
let cpu = 0;
for (const set of BENCHMARK.sets) {
  for (const row of await loadBenchmark({ set, limit: count })) {
    const samples = resample(row.samples, row.sampleRate, rate);
    const stages = new Map();
    const start = cpuUsage();
    const result = recognize(samples, rate, {
      ...options,
      profile: (name, ms) => stages.set(name, (stages.get(name) ?? 0) + ms),
    });
    const measured = cpuUsage(start);
    const seconds = (measured.user + measured.system) / 1e6;
    const duration = samples.length / rate;
    cpu += seconds;
    audio += duration;
    console.log(
      JSON.stringify({
        id: row.id,
        duration,
        seconds,
        stages: Object.fromEntries(stages),
        result,
      })
    );
  }
}
if (profilePath) {
  const { profile } = await profiler.post('Profiler.stop');
  writeFileSync(profilePath, JSON.stringify(profile));
  profiler.disconnect();
}
console.log(JSON.stringify({ engine, cpu, audio, rtf: cpu / audio }));
