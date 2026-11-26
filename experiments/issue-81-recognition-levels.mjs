// Issue 81: does 8 kHz/low differ from 16 kHz/medium on one benchmark row?
import { recognize } from '../src/index.js';
import { resample } from '../src/audio/resample.js';
import { BENCHMARK, loadBenchmark } from '../tests/heavy/helpers/benchmark.js';

const set = BENCHMARK.sets[0];
const [row] = await loadBenchmark({ set, limit: 1 });
for (const [rate, level] of [
  [8000, 'low'],
  [16000, 'low'],
  [16000, 'medium'],
]) {
  const samples = resample(row.samples, row.sampleRate, rate);
  const result = recognize(samples, rate, { level, engine: 'js' });
  console.log(rate, level, JSON.stringify(result.text), result.ipa);
}
