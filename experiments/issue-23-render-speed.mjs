/**
 * Issue 23: real-time factor of whole renders with the JavaScript
 * VoiceRenderer (`kernel: 'wasm'`) and with Rust engine builds, interleaved
 * run by run so that load on a shared machine hits every build alike.
 * Prints the least RTF of RUNS runs per renderer and its ratio to
 * JavaScript (above 1: slower than JavaScript).
 *
 *   node experiments/issue-23-render-speed.mjs a.wasm [b.wasm ...]
 *
 * TIER=<tier> (default high), RUNS=<n> (default 3),
 * TEXT=<text> (default the sentence of the heavy performance tests).
 */
import { readFileSync } from 'node:fs';
import { renderPlan } from '../src/acoustics/voice.js';
import { loadEngineModule } from '../src/engine/wasm-loader.js';
import { RustVoiceRenderer } from '../src/engine/rust-renderer.js';
import { prepareUtterance } from '../src/synthesize.js';

const TIER = process.env.TIER ?? 'high';
const RUNS = Number(process.env.RUNS ?? 3);
const TEXT = process.env.TEXT ?? 'The quick brown fox jumps over the dog.';
const files = process.argv.slice(2);
const { plan, renderOptions } = prepareUtterance(TEXT, { tier: TIER, seed: 1 });

const runs = [
  ['javascript', () => renderPlan(plan, { ...renderOptions, kernel: 'wasm' })],
];
for (const file of files) {
  const engine = await loadEngineModule(readFileSync(file), { simd: 'auto' });
  runs.push([
    file,
    () => {
      const renderer = new RustVoiceRenderer(engine, plan, renderOptions);
      try {
        const samples = new Float32Array(renderer.totalSamples);
        renderer.render(samples);
        return samples;
      } finally {
        renderer.free();
      }
    },
  ]);
}
const best = runs.map(() => Infinity);
let seconds = 0;
for (let run = 0; run < RUNS; run++) {
  runs.forEach(([, render], index) => {
    const started = globalThis.performance.now();
    const samples = render();
    best[index] = Math.min(
      best[index],
      (globalThis.performance.now() - started) / 1000
    );
    seconds = samples.length / renderOptions.sampleRate;
  });
}
console.log(`${TIER}: ${seconds.toFixed(2)} s of audio, least of ${RUNS} runs`);
runs.forEach(([name], index) => {
  console.log(
    `${name}: RTF ${(best[index] / seconds).toFixed(3)}, ${(best[index] / best[0]).toFixed(3)}x javascript`
  );
});
