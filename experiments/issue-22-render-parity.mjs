// Compare VoiceRenderer (JS) with RustVoiceRenderer for one text and tier.
// Usage: node experiments/issue-22-render-parity.mjs [tier] [text]
import { prepareUtterance } from '../src/synthesize.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { renderPlanRust } from '../src/engine/rust-renderer.js';
import { loadEngineModule } from '../src/engine/wasm-loader.js';

const tier = process.argv[2] ?? 'minimal';
const text = process.argv[3] ?? 'Hello world.';
const engine = await loadEngineModule();
const { plan, renderOptions } = prepareUtterance(text, { tier, seed: 1 });
let start = globalThis.performance.now();
const expected = renderPlan(plan, renderOptions);
const js = globalThis.performance.now() - start;
start = globalThis.performance.now();
const actual = renderPlanRust(engine, plan, renderOptions);
const rust = globalThis.performance.now() - start;
let max = 0;
let at = -1;
for (let i = 0; i < expected.length; i++) {
  const d = Math.abs(actual[i] - expected[i]);
  if (d > max) {
    max = d;
    at = i;
  }
}
console.log(
  `${tier}: ${expected.length} samples, max abs diff ${max} at ${at}, js ${js.toFixed(0)} ms, rust ${rust.toFixed(0)} ms`
);
