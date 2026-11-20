/** Compare one and four Rust workers on the 60-second acceptance fixture. */
import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { recognizeAsync, synthesize } from '../src/index.js';
import { resample } from '../src/audio/resample.js';

export const sampleRate = 16000;
export const duration = 60;

export function recognitionFixture() {
  const { samples, sampleRate: synthesisRate } = synthesize(
    'The quick brown fox jumps over the lazy dog.',
    { tier: 'minimal', seed: 1, engine: 'js' }
  );
  const phrase = resample(samples, synthesisRate, sampleRate);
  const input = new Float32Array(duration * sampleRate);
  const step = phrase.length + Math.round(0.35 * sampleRate);
  for (let at = 0; at + phrase.length < input.length; at += step) {
    input.set(phrase, at);
  }
  return input;
}

export async function timeRecognition(samples, options) {
  const startCpu = process.cpuUsage();
  const started = performance.now();
  const result = await recognizeAsync(samples, sampleRate, {
    ...options,
    languages: ['en'],
  });
  const elapsed = (performance.now() - started) / 1000;
  const { user, system } = process.cpuUsage(startCpu);
  return { elapsed, cpu: (user + system) / 1e6, result };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const cores = availableParallelism();
  if (cores < 4) {
    console.log(`Needs four logical cores, found ${cores}.`);
  } else {
    const samples = recognitionFixture();
    const rows = [];
    for (const threads of [1, 4]) {
      const { elapsed, cpu, result } = await timeRecognition(samples, {
        engine: 'rust',
        level: 'high',
        threads,
      });
      rows.push({ threads, elapsed, cpu, result });
    }
    const [one, four] = rows;
    console.log({
      cores,
      duration,
      measurements: rows.map(({ threads, elapsed, cpu }) => ({
        threads,
        elapsed,
        cpu,
      })),
      speedup: one.elapsed / four.elapsed,
      resultsMatch: JSON.stringify(one.result) === JSON.stringify(four.result),
    });
  }
}
