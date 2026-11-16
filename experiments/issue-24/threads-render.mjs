/**
 * A render of 'Hello.' (tier high, seed 1) in a 40 cm enclosure with the
 * threads build of the engine on 1, 2 and 4 threads: the samples must be
 * the same bits, and the time per thread count is printed.
 *
 *   node experiments/issue-24/threads-render.mjs [seconds]
 *   bun experiments/issue-24/threads-render.mjs [seconds]
 *   deno run -A experiments/issue-24/threads-render.mjs [seconds]
 *
 * Needs src/engine/voice-simulator-threads.wasm
 * (node scripts/build-wasm.mjs --threads).
 */

import { RustVoiceRenderer } from '../../src/engine/rust-renderer.js';
import { loadEngineModule } from '../../src/engine/wasm-loader.js';
import { prepareUtterance } from '../../src/synthesize.js';

const seconds = Number(
  globalThis.process?.argv?.[2] ?? globalThis.Deno?.args?.[0] ?? 0.05
);
const { plan, renderOptions } = prepareUtterance('Hello.', {
  tier: 'high',
  seed: 1,
});
const options = {
  ...renderOptions,
  enclosure: { width: 40, height: 40, depth: 40 },
  threadMinLinks: 0,
};

let reference;
for (const threads of [1, 2, 4]) {
  const engine = await loadEngineModule(undefined, { threads });
  const renderer = new RustVoiceRenderer(engine, plan, options);
  const samples = new Float32Array(Math.round(seconds * renderer.sampleRate));
  const started = globalThis.performance.now();
  renderer.render(samples);
  const elapsed = globalThis.performance.now() - started;
  const used = renderer.threads;
  renderer.free();
  engine.close();
  reference ??= samples;
  const same = samples.every((value, index) =>
    Object.is(value, reference[index])
  );
  console.log(
    `threads ${threads}: engine.threads ${engine.threads}, render threads ${used}, ` +
      `${samples.length} samples in ${elapsed.toFixed(0)} ms, bit-identical ${same}`
  );
}
