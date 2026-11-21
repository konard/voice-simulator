/** Show where a fresh process spends time on an 8 kHz recognition WAV. Unlicense. */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { decodeWav } from '../src/audio/wav.js';

const start = performance.now();
const { createRecognitionEngine } =
  await import('../src/recognition/engine.js');
const { recognize } = await import('../src/recognition/recognizer.js');
const imported = performance.now();
const engine = globalThis.process.argv[3] ?? 'rust';
const kernels = await createRecognitionEngine({ engine, threads: 1 });
const loaded = performance.now();
const { samples, sampleRate } = decodeWav(
  readFileSync(globalThis.process.argv[2])
);
const times = new Map([
  ['Module import', imported - start],
  ['Engine', loaded - imported],
]);
const result = recognize(samples, sampleRate, {
  engine,
  threads: 1,
  kernels,
  level: 'low',
  includeModeLabels: false,
  profile(stage, ms) {
    times.set(stage, (times.get(stage) ?? 0) + ms);
  },
});
times.set('Total', performance.now() - start);
console.log(result.text);
for (const [stage, ms] of times) {
  console.log(`${stage.padEnd(23)} ${ms.toFixed(2)} ms`);
}
